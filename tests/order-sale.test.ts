import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdateMany: vi.fn(),
  orderFindUniqueAfterUpdate: vi.fn(),
  branchFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  createSale: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));
vi.mock("../src/core/sales-create", () => ({ createSale: mocks.createSale }));

import { createSaleFromOrder } from "../src/core/order-sale";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({
      order: {
        findUnique: mocks.orderFindUnique,
        updateMany: mocks.orderUpdateMany,
      },
      branch: { findUnique: mocks.branchFindUnique },
      auditLog: { create: mocks.auditCreate },
    }),
  );
  mocks.branchFindUnique.mockResolvedValue({ organizationId: "org-1" });
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
});

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
  it("uses the actual weighed quantity and atomically marks the order paid", async () => {
    const order = readyOrder({ items: [{ id: "item-1", productId: "product-1", quantity: "1.5000", actualQuantity: "1.7200", unitPrice: "20.00" }] });
    mocks.orderFindUnique.mockResolvedValueOnce(order).mockResolvedValueOnce({ ...order, saleId: "sale-1", status: "PAID" });
    mocks.createSale.mockResolvedValue({ id: "sale-1", total: "34.40", status: "COMPLETED" });
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });

    const result = await createSaleFromOrder({
      branchId: "branch-1",
      orderId: "order-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      payments: [{ method: "CASH", amount: "34.40" }],
    });

    expect(mocks.createSale).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "customer-1",
      items: [{ productId: "product-1", quantity: "1.7200", unitPrice: "20.00" }],
      payments: [{ method: "CASH", amount: "34.40" }],
    }), expect.anything());
    expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
      where: { id: "order-1", branchId: "branch-1", status: "READY", saleId: null },
      data: { saleId: "sale-1", status: "PAID" },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "ORDER_PAID",
        entityId: "order-1",
      }),
    }));
    expect(result.order).toEqual(expect.objectContaining({ id: "order-1", saleId: "sale-1", status: "PAID" }));
    expect(result.usedQuantities[0].quantity).toBe("1.7200");
  });

  it("does not allow a sale before the order is ready", async () => {
    mocks.orderFindUnique.mockResolvedValue(readyOrder({ status: "PREPARING" }));

    await expect(createSaleFromOrder({
      branchId: "branch-1",
      orderId: "order-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      payments: [{ method: "CASH", amount: "30.00" }],
    })).rejects.toThrow("ORDER_NOT_READY_FOR_SALE");
    expect(mocks.createSale).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("requires payment to match the final weighed order total", async () => {
    mocks.orderFindUnique.mockResolvedValue(readyOrder({ items: [{ id: "item-1", productId: "product-1", quantity: "1.5000", actualQuantity: "1.7200", unitPrice: "20.00" }] }));

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
    mocks.orderFindUnique.mockResolvedValue(readyOrder({ branchId: "branch-2" }));

    await expect(createSaleFromOrder({
      branchId: "branch-1",
      orderId: "order-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      payments: [{ method: "CASH", amount: "30.00" }],
    })).rejects.toThrow("ORDER_NOT_FOUND");
    expect(mocks.createSale).not.toHaveBeenCalled();
  });

  it("rolls back the conversion when the order changes before linking", async () => {
    const order = readyOrder({ items: [{ id: "item-1", productId: "product-1", quantity: "1.5000", actualQuantity: "1.7200", unitPrice: "20.00" }] });
    mocks.orderFindUnique.mockResolvedValue(order);
    mocks.createSale.mockResolvedValue({ id: "sale-1", total: "34.40", status: "COMPLETED" });
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });

    await expect(createSaleFromOrder({
      branchId: "branch-1",
      orderId: "order-1",
      registerSessionId: "session-1",
      cashierId: "cashier-1",
      payments: [{ method: "CASH", amount: "34.40" }],
    })).rejects.toThrow("ORDER_CHANGED_DURING_SALE");

    expect(mocks.createSale).toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
