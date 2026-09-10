import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), update: vi.fn() },
    authorizationApproval: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn()
  }
}));

import { prisma } from "../src/lib/prisma";
import { authorizationIntegrityHash, resolveAuthorization } from "../src/core/authorization";

const db = prisma as any;

const approver = {
  id: "manager-1",
  status: "ACTIVE",
  organizationId: "org-1",
  roles: [{ role: { name: "GERENTE" } }],
  branchAccess: [{ branchId: "branch-1" }]
};

function request(overrides: Record<string, unknown> = {}) {
  const base = {
    id: "auth-1",
    organizationId: "org-1",
    branchId: "branch-1",
    requestedById: "cashier-1",
    status: "PENDING",
    type: "SALE_CANCEL",
    reason: "Cancelación autorizada",
    entityType: "Sale",
    entityId: "sale-1",
    beforeData: { id: "sale-1", status: "COMPLETED" },
    requestedData: { id: "sale-1", status: "CANCELLED" }
  };
  const value = { ...base, ...overrides } as any;
  value.integrityHash = authorizationIntegrityHash({
    organizationId: value.organizationId,
    branchId: value.branchId,
    requestedById: value.requestedById,
    type: value.type,
    reason: value.reason,
    entityType: value.entityType,
    entityId: value.entityId,
    beforeData: value.beforeData,
    requestedData: value.requestedData
  });
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(approver);
  db.authorizationApproval.create.mockResolvedValue({ id: "approval-1", decision: "APPROVED" });
  db.auditLog.create.mockResolvedValue({ id: "audit-1" });
  db.authorizationRequest.update.mockResolvedValue({ id: "auth-1", status: "APPROVED" });
});

describe("authorization approval transaction integrity", () => {
  it("revalidates the request inside the transaction before approving", async () => {
    const initial = request();
    const changedInsideTransaction = request({ reason: "Motivo alterado dentro de la transacción" });
    db.authorizationRequest.findUnique
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(changedInsideTransaction);
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      user: { findUnique: vi.fn().mockResolvedValue(approver) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(changedInsideTransaction), update: vi.fn() },
      authorizationApproval: { create: vi.fn() },
      auditLog: { create: vi.fn() }
    }));

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
  });

  it("rejects a tampered stored integrity hash inside the transaction", async () => {
    const initial = request();
    const tampered = request({ integrityHash: "tampered-hash" });
    db.authorizationRequest.findUnique
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(tampered);
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      user: { findUnique: vi.fn().mockResolvedValue(approver) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(tampered), update: vi.fn() },
      authorizationApproval: { create: vi.fn() },
      auditLog: { create: vi.fn() }
    }));

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
  });

  it("rejects a request resolved before the approval transaction can claim it", async () => {
    const initial = request();
    const alreadyResolved = request({ status: "APPROVED" });
    db.authorizationRequest.findUnique
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(alreadyResolved);
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      user: { findUnique: vi.fn().mockResolvedValue(approver) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(alreadyResolved), update: vi.fn() },
      authorizationApproval: { create: vi.fn() },
      auditLog: { create: vi.fn() }
    }));

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_ALREADY_RESOLVED");
  });

  it("approves only after the transaction copy passes the same integrity checks", async () => {
    const current = request();
    db.authorizationRequest.findUnique.mockResolvedValue(current);
    const txAuthorizationRequest = {
      findUnique: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue({ id: "auth-1", status: "APPROVED" })
    };
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      user: { findUnique: vi.fn().mockResolvedValue(approver) },
      authorizationRequest: txAuthorizationRequest,
      authorizationApproval: { create: vi.fn().mockResolvedValue({ id: "approval-1", decision: "APPROVED" }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) }
    }));

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .resolves.toMatchObject({ approval: { id: "approval-1", decision: "APPROVED" } });
    expect(txAuthorizationRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "auth-1", status: "PENDING" }
    }));
  });
});
