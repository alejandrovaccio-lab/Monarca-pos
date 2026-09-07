import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createSale: vi.fn(),
  attachSaleToOrder: vi.fn(),
  transitionOrder: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({ prisma: { order: { findUnique: mocks.findUnique } } }));
vi.mock("../src/core/sales-create", () => ({ createSale: mocks.createSale }));
vi.mock("../src/core/orders", () => ({ attachSaleToOrder: mocks.attachSaleToOrder, transitionOrder: mocks.transitionOrder }));

import { createSaleFromOrder } from "../src/core/order-sale";

beforeEach(() => vi.clearAllMocks());

function readyOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    branchId: "branch-1",
    customerId: "customer-1",
    status: "READY",
    saleId: null,
    customer: { id: "customer-1", name: "Alex" },
    items: [{ id: "item-1", productId: "product-1", quantity: "1.5000", actualQuantity: null, unitPrice: "20.00" }],
    ...overrides,
  };
}

describe("order to sale", () => {
  it("uses the actual weighed quantity when creating the sale", async () => {
    mocks.findUnique.mockResolvedValue(readyOrder({ items: [{ id: "item-1", productId: "product-1", quantity: "1.5000", actualQuantity: "1.7200", unitPrice: "20.00" }] }));
    mocks.createSale.mockResolvedValue({ id: "sale-1", total: "34.40", status: "COMPLETED" });
    mocks.attachSaleToOrder.mockResolvedValue({ id: "order-1", saleId: "sale-1", status: "READY" });
    mocks.transitionOrder.mockResolvedValue({ id: "order-1", saleId: "sale-1", status: "PAID" });

    const result = await createSaleFromOrder({
      branchId: "branch-1",
      orderId: "order-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      payments: [{ method: "CASH", amount: "34.40" }],
    });

    expect(mocks.createSale).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "customer-1",
      items: [{ productId: "product-1", quantity: "1.72", unitPrice: "20.00" }],
      payments: [{ method: "CASH", amount: "34.40" }],
    }));
    expect(mocks.attachSaleToOrder).toHaveBeenCalledWith({ branchId: "branch-1", orderId: "order-1", saleId: "sale-1" });
    expect(mocks.transitionOrder).toHaveBeenCalledWith(expect.objectContaining({ status: "PAID" }));
    expect(result.usedQuantities[0].quantity).toBe("1.7200");
  });

  it("does not allow a sale before the order is ready", async () => {
    mocks.findUnique.mockResolvedValue(readyOrder({ status: "PREPARING" }));

    await expect(createSaleFromOrder({
      branchId: "branch-1",
      orderId: "order-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      payments: [{ method: "CASH", amount: "30.00" }],
    })).rejects.toThrow("ORDER_NOT_READY_FOR_SALE");
    expect(mocks.createSale).not.toHaveBeenCalled();
  });

  it("requires payment to match the final weighed order total", async () => {
    mocks.findUnique.mockResolvedValue(readyOrder({ items: [{ id: "item-1", productId: "product-1", quantity: "1.5000", actualQuantity: "1.7200", unitPrice: "20.00" }] }));

    await expect(createSaleFromOrder({
      branchId: "branch-1",
      orderId: "order-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      payments: [{ method: "CASH", amount: "30.00" }],
    })).rejects.toThrow("ORDER_PAYMENT_TOTAL_MISMATCH");
    expect(mocks.createSale).not.toHaveBeenCalled();
  });

  it("blocks cross-branch order access", async () => {
    mocks.findUnique.mockResolvedValue(readyOrder({ branchId: "branch-2" }));

    await expect(createSaleFromOrder({
      branchId: "branch-1",
      orderId: "order-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      payments: [{ method: "CASH", amount: "30.00" }],
    })).rejects.toThrow("ORDER_NOT_FOUND");
    expect(mocks.createSale).not.toHaveBeenCalled();
  });
});
