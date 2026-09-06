import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";

export type OrderChannelInput = "WHATSAPP" | "PICKUP" | "OTHER";
export type OrderStatusInput = "RECEIVED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";

export type OrderItemInput = {
  productId: string;
  quantity: number | string;
};

const transitions: Record<OrderStatusInput, OrderStatusInput[]> = {
  RECEIVED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

function decimal(value: number | string) {
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    throw new Error("ORDER_AMOUNT_INVALID");
  }
}

function positiveDecimal(value: number | string, errorCode: string) {
  const result = decimal(value);
  if (!result.isFinite() || result.lte(0)) throw new Error(errorCode);
  return result;
}

function roundMoney(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2);
}

function orderTotal(items: Array<{ quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }>) {
  return roundMoney(items.reduce((sum, item) => sum.add(item.quantity.mul(item.unitPrice)), new Prisma.Decimal(0)));
}

export async function createOrder(input: {
  branchId: string;
  customerId?: string;
  channel: OrderChannelInput;
  requestedAt?: string | Date;
  items: OrderItemInput[];
}) {
  if (!input.branchId || !input.items.length) throw new Error("ORDER_CONTEXT_REQUIRED");
  if (!["WHATSAPP", "PICKUP", "OTHER"].includes(input.channel)) throw new Error("ORDER_CHANNEL_INVALID");

  const requestedAt = input.requestedAt ? new Date(input.requestedAt) : new Date();
  if (Number.isNaN(requestedAt.getTime())) throw new Error("ORDER_DATE_INVALID");

  const branch = await prisma.branch.findUnique({
    where: { id: input.branchId },
    select: { id: true, organizationId: true },
  });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");

  if (input.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, organizationId: true },
    });
    if (!customer || customer.organizationId !== branch.organizationId) throw new Error("CUSTOMER_INVALID");
  }

  const preparedItems: Array<{
    productId: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
  }> = [];

  for (const item of input.items) {
    if (!item.productId) throw new Error("ORDER_ITEM_INVALID");
    const quantity = positiveDecimal(item.quantity, "ORDER_QUANTITY_INVALID");
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        publicPrice: true,
        branchProducts: { where: { branchId: input.branchId }, select: { isEnabled: true } },
        prices: {
          where: { branchId: input.branchId, effectiveAt: { lte: requestedAt } },
          orderBy: { effectiveAt: "desc" },
          take: 1,
          select: { price: true },
        },
      },
    });

    if (!product || product.organizationId !== branch.organizationId || product.status !== "ACTIVE") {
      throw new Error("PRODUCT_NOT_AVAILABLE");
    }
    if (!product.branchProducts.length || !product.branchProducts[0].isEnabled) {
      throw new Error("PRODUCT_NOT_AVAILABLE_AT_BRANCH");
    }

    const configuredPrice = product.prices[0]?.price ?? product.publicPrice;
    if (!configuredPrice) throw new Error("PRICE_NOT_CONFIGURED");

    preparedItems.push({
      productId: product.id,
      quantity,
      unitPrice: positiveDecimal(configuredPrice.toString(), "ORDER_PRICE_INVALID"),
    });
  }

  const total = orderTotal(preparedItems);
  const orderId = randomUUID();

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        id: orderId,
        branchId: input.branchId,
        customerId: input.customerId || null,
        channel: input.channel,
        status: "RECEIVED",
        requestedAt,
        items: {
          create: preparedItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
      include: { items: true },
    });

    await tx.auditLog.create({
      data: {
        organizationId: branch.organizationId,
        branchId: input.branchId,
        action: "ORDER_RECEIVED",
        entityType: "Order",
        entityId: created.id,
        beforeData: null,
        afterData: {
          orderId: created.id,
          channel: input.channel,
          customerId: input.customerId || null,
          total: total.toFixed(2),
        },
      },
    });

    return created;
  });

  return { ...order, total: total.toFixed(2) };
}

export async function listOrders(input: {
  branchId: string;
  status?: OrderStatusInput;
  limit?: number;
}) {
  if (!input.branchId) throw new Error("BRANCH_ID_REQUIRED");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  if (input.status && !Object.prototype.hasOwnProperty.call(transitions, input.status)) throw new Error("ORDER_STATUS_INVALID");

  const orders = await prisma.order.findMany({
    where: { branchId: input.branchId, ...(input.status ? { status: input.status } : {}) },
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true } } } },
    },
  });

  return orders.map((order) => ({
    ...order,
    total: orderTotal(order.items.filter((item) => item.unitPrice !== null).map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice! }))).toFixed(2),
  }));
}

export async function transitionOrder(input: {
  branchId: string;
  orderId: string;
  status: OrderStatusInput;
  preparedById?: string;
}) {
  if (!input.branchId || !input.orderId) throw new Error("ORDER_CONTEXT_REQUIRED");
  if (!Object.prototype.hasOwnProperty.call(transitions, input.status)) throw new Error("ORDER_STATUS_INVALID");

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, branchId: true, status: true, saleId: true },
  });
  if (!order || order.branchId !== input.branchId) throw new Error("ORDER_NOT_FOUND");
  if (!transitions[order.status as OrderStatusInput].includes(input.status)) throw new Error("ORDER_TRANSITION_INVALID");
  if (input.status === "COMPLETED" && !order.saleId) throw new Error("ORDER_SALE_REQUIRED");

  if (input.preparedById) {
    const user = await prisma.user.findUnique({
      where: { id: input.preparedById },
      select: { id: true, organizationId: true, status: true, branchAccess: { where: { branchId: input.branchId }, select: { branchId: true } } },
    });
    const branch = await prisma.branch.findUnique({ where: { id: input.branchId }, select: { organizationId: true } });
    if (!user || !branch || user.status !== "ACTIVE" || user.organizationId !== branch.organizationId || !user.branchAccess.length) {
      throw new Error("PREPARER_NOT_AUTHORIZED");
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: input.orderId },
      data: {
        status: input.status,
        ...(input.status === "PREPARING" || input.status === "READY" ? { preparedById: input.preparedById || null } : {}),
      },
      include: { items: true, customer: true },
    });

    const branch = await tx.branch.findUnique({ where: { id: input.branchId }, select: { organizationId: true } });
    if (branch) {
      await tx.auditLog.create({
        data: {
          organizationId: branch.organizationId,
          branchId: input.branchId,
          userId: input.preparedById || null,
          action: `ORDER_${input.status}`,
          entityType: "Order",
          entityId: updated.id,
          beforeData: { status: order.status },
          afterData: { status: updated.status, saleId: updated.saleId },
        },
      });
    }

    return updated;
  });
}

export async function attachSaleToOrder(input: { branchId: string; orderId: string; saleId: string }) {
  if (!input.branchId || !input.orderId || !input.saleId) throw new Error("ORDER_CONTEXT_REQUIRED");

  const [order, sale] = await Promise.all([
    prisma.order.findUnique({ where: { id: input.orderId }, select: { id: true, branchId: true, status: true, saleId: true } }),
    prisma.sale.findUnique({ where: { id: input.saleId }, select: { id: true, branchId: true, status: true, customerId: true } }),
  ]);
  if (!order || order.branchId !== input.branchId) throw new Error("ORDER_NOT_FOUND");
  if (!sale || sale.branchId !== input.branchId || sale.status !== "COMPLETED") throw new Error("SALE_INVALID");
  if (order.saleId && order.saleId !== sale.id) throw new Error("ORDER_ALREADY_LINKED");
  if (order.status === "CANCELLED") throw new Error("ORDER_CANCELLED");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({ where: { id: order.id }, data: { saleId: sale.id }, include: { items: true, customer: true } });
    const branch = await tx.branch.findUnique({ where: { id: input.branchId }, select: { organizationId: true } });
    if (branch) {
      await tx.auditLog.create({
        data: {
          organizationId: branch.organizationId,
          branchId: input.branchId,
          action: "ORDER_LINKED_TO_SALE",
          entityType: "Order",
          entityId: order.id,
          beforeData: { saleId: order.saleId },
          afterData: { saleId: sale.id },
        },
      });
    }
    return updated;
  });
}
