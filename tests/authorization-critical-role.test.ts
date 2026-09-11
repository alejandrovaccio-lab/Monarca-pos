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
import { resolveAuthorization } from "../src/core/authorization";

const db = prisma as any;

const manager = {
  id: "manager-1",
  status: "ACTIVE",
  organizationId: "org-1",
  roles: [{ role: { name: "GERENTE" } }],
  branchAccess: [{ branchId: "branch-1" }]
};

const admin = {
  id: "admin-1",
  status: "ACTIVE",
  organizationId: "org-1",
  roles: [{ role: { name: "ADMIN" } }],
  branchAccess: [{ branchId: "branch-1" }]
};

function request(type: string) {
  return {
    id: "auth-1",
    organizationId: "org-1",
    branchId: "branch-1",
    requestedById: "cashier-1",
    status: "PENDING",
    type,
    reason: "Cambio solicitado",
    entityType: "Configuration",
    entityId: "config-1",
    beforeData: { enabled: false },
    requestedData: { enabled: true },
    integrityHash: null
  };
}

beforeEach(() => vi.clearAllMocks());

describe("critical authorization role policy", () => {
  it("blocks a manager from approving a critical authorization", async () => {
    db.user.findUnique.mockResolvedValue(manager);
    db.authorizationRequest.findUnique.mockResolvedValue(request("TAX_CHANGE"));

    await expect(resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "APPROVED"
    })).rejects.toThrow("AUTHORIZATION_CRITICAL_APPROVER_REQUIRED");

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("allows an admin to approve a critical authorization through the normal single approval flow", async () => {
    const current = request("ACCESS_CHANGE");
    db.user.findUnique.mockResolvedValue(admin);
    db.authorizationRequest.findUnique.mockResolvedValue(current);
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      user: { findUnique: vi.fn().mockResolvedValue(admin) },
      authorizationRequest: {
        findUnique: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue({ id: "auth-1", status: "APPROVED" })
      },
      authorizationApproval: { create: vi.fn().mockResolvedValue({ id: "approval-1", decision: "APPROVED" }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) }
    }));

    await expect(resolveAuthorization({
      requestId: "auth-1",
      approverId: "admin-1",
      decision: "APPROVED"
    })).resolves.toMatchObject({ approval: { id: "approval-1", decision: "APPROVED" } });
  });
});
