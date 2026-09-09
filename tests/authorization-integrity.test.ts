import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/lib/prisma", () => ({ prisma }));

import { resolveAuthorization } from "../src/core/authorization";

const approver = {
  id: "manager-1",
  organizationId: "org-1",
  status: "ACTIVE",
  roles: [{ role: { name: "GERENTE" } }],
  branchAccess: [{ branchId: "branch-1" }],
};

const request = {
  id: "auth-1",
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "cashier-1",
  status: "PENDING",
  entityType: "ProductPrice",
  entityId: "product-1",
  beforeData: { price: 10 },
  requestedData: { price: 12 },
};

function transactionMock(options: { update?: unknown; approval?: unknown; audit?: unknown; updateError?: unknown } = {}) {
  const tx = {
    user: { findUnique: vi.fn().mockResolvedValue(approver) },
    authorizationRequest: {
      update: vi.fn(async () => {
        if (options.updateError) throw options.updateError;
        return options.update ?? { ...request, status: "APPROVED", resolvedAt: new Date() };
      }),
    },
    authorizationApproval: {
      create: vi.fn().mockResolvedValue(options.approval ?? { id: "approval-1" }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue(options.audit ?? { id: "audit-1" }),
    },
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(tx));
  return tx;
}

describe("Authorization resolution integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(approver);
    prisma.authorizationRequest.findUnique.mockResolvedValue(request);
  });

  it("resolves once and creates exactly one approval and audit entry", async () => {
    const tx = transactionMock();

    const result = await resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "APPROVED",
      notes: "approved",
    });

    expect(result.request.status).toBe("APPROVED");
    expect(tx.authorizationRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "auth-1", status: "PENDING" },
      data: expect.objectContaining({ status: "APPROVED" }),
    }));
    expect(tx.authorizationApproval.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a second resolution after the request is already resolved", async () => {
    const tx = transactionMock();
    prisma.authorizationRequest.findUnique
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce({ ...request, status: "APPROVED" });

    await resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "APPROVED",
    });

    await expect(resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "REJECTED",
    })).rejects.toThrow("AUTHORIZATION_ALREADY_RESOLVED");

    expect(tx.authorizationApproval.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("maps a concurrent or already-resolved claim failure to AUTHORIZATION_ALREADY_RESOLVED", async () => {
    const tx = transactionMock({ updateError: { code: "P2025" } });

    await expect(resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "REJECTED",
    })).rejects.toThrow("AUTHORIZATION_ALREADY_RESOLVED");

    expect(tx.authorizationApproval.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not create approval or audit data when the resolution claim fails", async () => {
    const tx = transactionMock({ updateError: new Error("DB_FAILURE") });

    await expect(resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "APPROVED",
    })).rejects.toThrow("DB_FAILURE");

    expect(tx.authorizationApproval.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("persists the authenticated approver and requested decision, not client-supplied identity", async () => {
    const tx = transactionMock();

    await resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "REJECTED",
      notes: "not authorized",
    });

    expect(tx.authorizationApproval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorizationRequestId: "auth-1",
        approverId: "manager-1",
        decision: "REJECTED",
        notes: "not authorized",
      }),
    });
  });
});
