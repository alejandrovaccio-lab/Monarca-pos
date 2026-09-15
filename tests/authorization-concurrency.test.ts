import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/lib/prisma", () => ({ prisma }));

import { authorizationIntegrityHash, resolveAuthorization } from "../src/core/authorization";

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
  type: "SALE_CANCEL",
  reason: "Autorización de prueba",
  entityType: "ProductPrice",
  entityId: "product-1",
  beforeData: { price: 10 },
  requestedData: { price: 12 },
};

const requestWithIntegrity = {
  ...request,
  integrityHash: authorizationIntegrityHash(request),
};

describe("Authorization resolution concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(approver);
    prisma.authorizationRequest.findUnique.mockResolvedValue(requestWithIntegrity);
  });

  it("allows only one winner when two concurrent resolutions race for the same pending request", async () => {
    let claimed = false;
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue(approver) },
      authorizationRequest: {
        findUnique: vi.fn().mockResolvedValue(requestWithIntegrity),
        update: vi.fn(async () => {
          if (claimed) throw { code: "P2025" };
          claimed = true;
          return { ...requestWithIntegrity, status: "APPROVED", resolvedAt: new Date() };
        }),
      },
      authorizationApproval: {
        create: vi.fn(async () => ({ id: "approval-1" })),
      },
      auditLog: {
        create: vi.fn(async () => ({ id: "audit-1" })),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: typeof tx) => unknown) => callback(tx));

    const results = await Promise.allSettled([
      resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }),
      resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "REJECTED" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")?.reason.message).toBe("AUTHORIZATION_ALREADY_RESOLVED");
    expect(tx.authorizationApproval.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.authorizationRequest.update).toHaveBeenCalledTimes(2);
  });

  it("does not allow a second concurrent decision to create an approval after the atomic claim fails", async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue(approver) },
      authorizationRequest: {
        findUnique: vi.fn().mockResolvedValue(requestWithIntegrity),
        update: vi.fn().mockRejectedValue({ code: "P2025" }),
      },
      authorizationApproval: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: typeof tx) => unknown) => callback(tx));

    await expect(resolveAuthorization({
      requestId: "auth-1",
      approverId: "manager-1",
      decision: "REJECTED",
    })).rejects.toThrow("AUTHORIZATION_ALREADY_RESOLVED");

    expect(tx.authorizationApproval.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
