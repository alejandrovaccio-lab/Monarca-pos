import { describe, expect, it, vi, beforeEach } from "vitest";

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
import { resolveAuthorization } from "../src/core/authorization";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

const activeApprover = {
  status: "ACTIVE",
  organizationId: "org-1",
  roles: [{ role: { name: "GERENTE" } }],
  branchAccess: [{ branchId: "branch-1" }]
};

const pendingRequest = {
  id: "auth-1",
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "cashier-1",
  status: "PENDING",
  entityType: "Sale",
  entityId: "sale-1"
};

describe("authorization approver revalidation", () => {
  it("revalidates the approver inside the transaction before resolving", async () => {
    db.user.findUnique
      .mockResolvedValueOnce(activeApprover)
      .mockResolvedValueOnce({ ...activeApprover, status: "INACTIVE" });
    db.authorizationRequest.findUnique.mockResolvedValue(pendingRequest);
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(db));

    await expect(resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "APPROVED"
    })).rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");

    expect(db.authorizationRequest.update).not.toHaveBeenCalled();
    expect(db.authorizationApproval.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("revalidates branch access inside the transaction before resolving", async () => {
    db.user.findUnique
      .mockResolvedValueOnce(activeApprover)
      .mockResolvedValueOnce({ ...activeApprover, branchAccess: [{ branchId: "branch-2" }] });
    db.authorizationRequest.findUnique.mockResolvedValue(pendingRequest);
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(db));

    await expect(resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "APPROVED"
    })).rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");

    expect(db.authorizationRequest.update).not.toHaveBeenCalled();
    expect(db.authorizationApproval.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
