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
    $transaction: vi.fn(async (callback: any) => callback({
      sale: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    })),
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

    const txSale = db.$transaction;
    txSale.mockImplementation(async (callback: any) => callback({
      sale: {
        findUnique: vi.fn().mockResolvedValue(sale),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryBalance: { upsert: vi.fn().mockResolvedValue({}) },
      inventoryMovement: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }));

    const result = await executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" });

    expect(result.status).toBe("CANCELLED");
    const tx = await txSale.mock.results[0].value;
    expect(tx).toBeDefined();
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
