import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, canApproveAuthorization } = vi.hoisted(() => ({
  prisma: {
    authorizationRequest: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  canApproveAuthorization: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({ prisma }));
vi.mock("../src/core/authorization", () => ({
  canApproveAuthorization,
  requestAuthorization: vi.fn(),
  authorizationIntegrityHash: vi.fn(() => "hash"),
}));

import { executeApprovedSaleChange } from "../src/core/sales";

const authorization = {
  id: "auth-1",
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "cashier-1",
  status: "APPROVED",
  type: "SALE_CANCEL",
  reason: "Prueba",
  entityType: "Sale",
  entityId: "sale-1",
  beforeData: { id: "sale-1", status: "COMPLETED" },
  requestedData: { id: "sale-1", status: "CANCELLED" },
  integrityHash: "hash",
  approvals: [{ id: "approval-1", approvedAt: new Date() }],
};

const executor = {
  id: "manager-1",
  organizationId: "org-1",
  status: "ACTIVE",
  roles: [{ role: { name: "GERENTE" } }],
  branchAccess: [{ branchId: "branch-1" }],
};

describe("Sale reversal serialization retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canApproveAuthorization.mockResolvedValue(true);
    prisma.authorizationRequest.findUnique.mockResolvedValue(authorization);
  });

  it("retries a transient Prisma serialization conflict and completes the transaction", async () => {
    let attempts = 0;
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
      user: { findUnique: vi.fn().mockResolvedValue(executor) },
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          id: "sale-1",
          branchId: "branch-1",
          status: "COMPLETED",
          items: [{ id: "item-1", productId: "product-1", quantity: 2, costSnapshot: 5 }],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      branchProduct: { findMany: vi.fn().mockResolvedValue([{ productId: "product-1" }]) },
      inventoryBalance: { upsert: vi.fn().mockResolvedValue({}) },
      inventoryMovement: { create: vi.fn().mockResolvedValue({ id: "movement-1" }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    };

    prisma.$transaction.mockImplementation(async (callback: (transaction: typeof tx) => unknown) => {
      attempts += 1;
      if (attempts === 1) throw { code: "P2034" };
      return callback(tx);
    });

    const result = await executeApprovedSaleChange({ requestId: "auth-1", executorId: "manager-1" });

    expect(result.status).toBe("CANCELLED");
    expect(attempts).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-serialization errors", async () => {
    const error = new Error("database unavailable");
    prisma.$transaction.mockRejectedValue(error);

    await expect(executeApprovedSaleChange({ requestId: "auth-1", executorId: "manager-1" })).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
