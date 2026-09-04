import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    branch: { findUnique: vi.fn() },
    sale: { findUnique: vi.fn(), updateMany: vi.fn() },
    inventoryBalance: { upsert: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../src/lib/prisma";
import { executeApprovedSaleChange } from "../src/core/sales";

const db = prisma as any;

const sale = {
  id: "sale-1",
  branchId: "branch-1",
  status: "COMPLETED",
  items: [
    { productId: "product-1", quantity: 2, costSnapshot: 10 },
    { productId: "product-2", quantity: 0.5, costSnapshot: 20 },
  ],
};

const authorization = {
  id: "request-1",
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "cashier-1",
  status: "APPROVED",
  entityType: "Sale",
  entityId: "sale-1",
  requestedData: { id: "sale-1", status: "CANCELLED" },
};

beforeEach(() => vi.clearAllMocks());

describe("authorized sale inventory restoration", () => {
  it("restores every sold item and records inventory movements", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);

    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    const movement = vi.fn().mockResolvedValue({});
    const audit = vi.fn().mockResolvedValue({});
    db.$transaction.mockImplementation(async (callback: any) => callback({
      sale: { findUnique: vi.fn().mockResolvedValue(sale), updateMany },
      inventoryBalance: { upsert },
      inventoryMovement: { create: movement },
      auditLog: { create: audit },
    }));

    const result = await executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" });

    expect(result.status).toBe("CANCELLED");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "sale-1", status: "COMPLETED" },
      data: { status: "CANCELLED" },
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(1, {
      where: { branchId_productId: { branchId: "branch-1", productId: "product-1" } },
      create: { branchId: "branch-1", productId: "product-1", quantity: 2 },
      update: { quantity: { increment: 2 } },
    });
    expect(upsert).toHaveBeenNthCalledWith(2, {
      where: { branchId_productId: { branchId: "branch-1", productId: "product-2" } },
      create: { branchId: "branch-1", productId: "product-2", quantity: 0.5 },
      update: { quantity: { increment: 0.5 } },
    });
    expect(movement).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledOnce();
  });

  it("does not execute an unapproved request", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({ ...authorization, status: "PENDING" });

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_NOT_APPROVED");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("blocks execution when the sale has already changed", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      sale: {
        findUnique: vi.fn().mockResolvedValue(sale),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("SALE_ALREADY_CHANGED");
  });
});
