import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    branch: { findUnique: vi.fn() },
    customer: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    order: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    sale: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../src/lib/prisma";
import { attachSaleToOrder, createOrder, listOrders, transitionOrder } from "../src/core/orders";

const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

function setupCreateContext() {
  db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" });
  db.customer.findUnique.mockResolvedValue({ id: "customer-1", organizationId: "org-1" });
  db.product.findUnique.mockResolvedValue({
    id: "product-1",
    organizationId: "org-1",
    status: "ACTIVE",
    publicPrice: 10,
    branchProducts: [{ isEnabled: true }],
    prices: [],
  });
}

describe("order lifecycle", () => {
  it("creates a WhatsApp order without touching inventory", async () => {
    setupCreateContext();
    const orderCreate = vi.fn().mockResolvedValue({
      id: "order-1",
      branchId: "branch-1",
      channel: "WHATSAPP",
      status: "RECEIVED",
      items: [{ productId: "product-1", quantity: 2, unitPrice: 10 }],
    });
    const auditCreate = vi.fn().mockResolvedValue({});
    db.$transaction.mockImplementation(async (callback: any) => callback({
      order: { create: orderCreate },
      auditLog: { create: auditCreate },
    }));

    const result = await createOrder({
      branchId: "branch-1",
      customerId: "customer-1",
      channel: "WHATSAPP",
      items: [{ productId: "product-1", quantity: 2 }],
    });

    expect(result.total).toBe("20.00");
    expect(orderCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "ORDER_RECEIVED" }) }));
  });

  it("lists orders with their calculated totals", async () => {
    db.order.findMany.mockResolvedValue([
      {
        id: "order-1",
        status: "RECEIVED",
        items: [
          { quantity: 2, unitPrice: 10, product: { id: "product-1", name: "Manzana", sku: "MAN-01" } },
        ],
        customer: { id: "customer-1", name: "Alex", phone: "4490000000" },
      },
    ]);

    const result = await listOrders({ branchId: "branch-1" });

    expect(result[0].total).toBe("20.00");
    expect(result[0].status).toBe("RECEIVED");
  });

  it("moves an order from received to preparing and records an audit", async () => {
    db.order.findUnique.mockResolvedValue({ id: "order-1", branchId: "branch-1", status: "RECEIVED", saleId: null });
    db.user.findUnique.mockResolvedValue({ id: "user-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });
    const updated = { id: "order-1", status: "PREPARING", items: [], customer: null, saleId: null };
    const orderUpdate = vi.fn().mockResolvedValue(updated);
    const auditCreate = vi.fn().mockResolvedValue({});
    db.$transaction.mockImplementation(async (callback: any) => callback({
      order: { update: orderUpdate },
      branch: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      auditLog: { create: auditCreate },
    }));

    const result = await transitionOrder({ branchId: "branch-1", orderId: "order-1", status: "PREPARING", preparedById: "user-1" });

    expect(result.status).toBe("PREPARING");
    expect(orderUpdate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "ORDER_PREPARING" }) }));
  });

  it("does not allow completion until a completed sale is linked", async () => {
    db.order.findUnique.mockResolvedValue({ id: "order-1", branchId: "branch-1", status: "READY", saleId: null });

    await expect(transitionOrder({ branchId: "branch-1", orderId: "order-1", status: "COMPLETED" })).rejects.toThrow("ORDER_SALE_REQUIRED");
  });

  it("links a completed sale to the order", async () => {
    db.order.findUnique.mockResolvedValue({ id: "order-1", branchId: "branch-1", status: "READY", saleId: null });
    db.sale.findUnique.mockResolvedValue({ id: "sale-1", branchId: "branch-1", status: "COMPLETED", customerId: "customer-1" });
    const updated = { id: "order-1", saleId: "sale-1", status: "READY", items: [], customer: null };
    const orderUpdate = vi.fn().mockResolvedValue(updated);
    const auditCreate = vi.fn().mockResolvedValue({});
    db.$transaction.mockImplementation(async (callback: any) => callback({
      order: { update: orderUpdate },
      branch: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      auditLog: { create: auditCreate },
    }));

    const result = await attachSaleToOrder({ branchId: "branch-1", orderId: "order-1", saleId: "sale-1" });

    expect(result.saleId).toBe("sale-1");
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "ORDER_LINKED_TO_SALE" }) }));
  });
});
