import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    branch: { findUnique: vi.fn() },
    registerSession: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    customer: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../src/lib/prisma";
import { createSale } from "../src/core/sales-create";

const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

function setupContext() {
  db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" });
  db.registerSession.findUnique.mockResolvedValue({ id: "session-1", closedAt: null, register: { branchId: "branch-1", status: "OPEN" } });
  db.user.findUnique.mockResolvedValue({ id: "cashier-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
  db.product.findUnique.mockResolvedValue({
    id: "product-1",
    organizationId: "org-1",
    name: "Manzana",
    status: "ACTIVE",
    publicPrice: 10,
    branchProducts: [{ isEnabled: true }],
    prices: [],
    costs: [{ cost: 5 }],
  });
}

describe("sale creation", () => {
  it("creates a paid sale, decrements inventory and records a sale movement", async () => {
    setupContext();
    const inventoryUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const movementCreate = vi.fn().mockResolvedValue({});
    const saleCreate = vi.fn().mockResolvedValue({ id: "sale-1", folio: "V-TEST", status: "COMPLETED", items: [], payments: [] });
    const auditCreate = vi.fn().mockResolvedValue({});
    db.$transaction.mockImplementation(async (callback: any) => callback({
      inventoryBalance: { updateMany: inventoryUpdate },
      inventoryMovement: { create: movementCreate },
      sale: { create: saleCreate },
      auditLog: { create: auditCreate },
    }));

    const result = await createSale({
      branchId: "branch-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      folio: "V-TEST",
      items: [{ productId: "product-1", quantity: 2 }],
      payments: [{ method: "CASH", amount: 20 }],
    });

    expect(result.total).toBe("20.00");
    expect(inventoryUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { quantity: { decrement: expect.anything() } } }));
    expect(movementCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "SALE", quantity: expect.anything() }) }));
    expect(saleCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "SALE_COMPLETED" }) }));
  });

  it("blocks a sale when inventory is insufficient", async () => {
    setupContext();
    const inventoryUpdate = vi.fn().mockResolvedValue({ count: 0 });
    db.$transaction.mockImplementation(async (callback: any) => callback({
      inventoryBalance: { updateMany: inventoryUpdate },
      inventoryMovement: { create: vi.fn() },
      sale: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }));

    await expect(createSale({
      branchId: "branch-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      items: [{ productId: "product-1", quantity: 2 }],
      payments: [{ method: "CASH", amount: 20 }],
    })).rejects.toThrow("INSUFFICIENT_INVENTORY");
  });

  it("rejects a price override because price changes require authorization", async () => {
    setupContext();

    await expect(createSale({
      branchId: "branch-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      items: [{ productId: "product-1", quantity: 1, unitPrice: 9 }],
      payments: [{ method: "CASH", amount: 9 }],
    })).rejects.toThrow("PRICE_OVERRIDE_AUTHORIZATION_REQUIRED");
  });

  it("requires the payments to match the exact sale total", async () => {
    setupContext();

    await expect(createSale({
      branchId: "branch-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      items: [{ productId: "product-1", quantity: 2 }],
      payments: [{ method: "CASH", amount: 19 }],
    })).rejects.toThrow("PAYMENT_TOTAL_MISMATCH");
  });
});
