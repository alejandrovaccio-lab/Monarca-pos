import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    authorizationApproval: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn()
  }
}));

import { prisma } from "../src/lib/prisma";
import { authorizationIntegrityHash, requestAuthorization, resolveAuthorization } from "../src/core/authorization";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

function transactionMock() {
  db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(db));
}

function approver(overrides: Record<string, unknown> = {}) {
  return {
    id: "manager-1",
    status: "ACTIVE",
    organizationId: "org-1",
    roles: [{ role: { name: "GERENTE" } }],
    branchAccess: [{ branchId: "branch-1" }],
    ...overrides
  };
}

function authorizationFixture(overrides: Record<string, unknown> = {}) {
  const request = {
    id: "auth-1",
    organizationId: "org-1",
    branchId: "branch-1",
    requestedById: "cashier-1",
    status: "PENDING",
    type: "SALE_CANCEL",
    reason: "Prueba tenant",
    entityType: "Sale",
    entityId: "sale-1",
    beforeData: { status: "COMPLETED" },
    requestedData: { status: "CANCELLED" },
    ...overrides
  };
  return {
    ...request,
    integrityHash: authorizationIntegrityHash({
      organizationId: request.organizationId,
      branchId: request.branchId,
      requestedById: request.requestedById,
      type: request.type,
      reason: request.reason,
      entityType: request.entityType,
      entityId: request.entityId,
      beforeData: request.beforeData,
      requestedData: request.requestedData
    })
  };
}

describe("authorization tenant integrity", () => {
  it("requires branch access to be scoped to the same organization when requesting authorization", async () => {
    db.user.findUnique.mockResolvedValue({
      status: "ACTIVE",
      organizationId: "org-1",
      branchAccess: [{ branchId: "branch-1" }]
    });
    db.authorizationRequest.create.mockResolvedValue({ id: "auth-1", status: "PENDING" });

    await expect(requestAuthorization({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "cashier-1",
      type: "SALE_CANCEL",
      reason: "Prueba",
      entityType: "Sale",
      entityId: "sale-1"
    })).resolves.toMatchObject({ id: "auth-1" });

    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cashier-1" },
      include: expect.objectContaining({
        branchAccess: {
          where: { branchId: "branch-1", branch: { organizationId: "org-1" } }
        }
      })
    }));
  });

  it("denies a requester when the branch is not returned inside the tenant-scoped access relation", async () => {
    db.user.findUnique.mockResolvedValue({
      status: "ACTIVE",
      organizationId: "org-1",
      branchAccess: []
    });

    await expect(requestAuthorization({
      organizationId: "org-1",
      branchId: "branch-from-org-2",
      requestedById: "cashier-1",
      type: "SALE_CANCEL",
      reason: "Prueba cross tenant",
      entityType: "Sale"
    })).rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });

  it("requires approver branch access to be tenant-scoped before resolving a branch authorization", async () => {
    const request = authorizationFixture();
    db.user.findUnique
      .mockResolvedValueOnce(approver())
      .mockResolvedValueOnce({ branchAccess: [] });
    db.authorizationRequest.findUnique.mockResolvedValue(request);

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
    expect(db.authorizationRequest.update).not.toHaveBeenCalled();
  });

  it("checks the approver branch relation against the authorization organization", async () => {
    const request = authorizationFixture();
    db.user.findUnique
      .mockResolvedValueOnce(approver())
      .mockResolvedValueOnce({ branchAccess: [{ branchId: "branch-1" }] })
      .mockResolvedValueOnce(approver());
    db.authorizationRequest.findUnique.mockResolvedValue(request);
    db.authorizationRequest.update.mockResolvedValue({ ...request, status: "APPROVED", resolvedAt: new Date() });
    db.authorizationApproval.create.mockResolvedValue({ id: "approval-1", decision: "APPROVED" });
    db.auditLog.create.mockResolvedValue({ id: "audit-1" });
    transactionMock();

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .resolves.toMatchObject({ approval: { id: "approval-1" } });

    expect(db.user.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: "manager-1" },
      select: {
        branchAccess: {
          where: { branchId: "branch-1", branch: { organizationId: "org-1" } },
          select: { branchId: true }
        }
      }
    });
  });

  it("prevents an approver from another organization even when the branch access row exists", async () => {
    const request = authorizationFixture();
    db.user.findUnique.mockResolvedValue(approver({ organizationId: "org-2" }));
    db.authorizationRequest.findUnique.mockResolvedValue(request);

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-2", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
    expect(db.authorizationRequest.update).not.toHaveBeenCalled();
  });
});
