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

function decimal(value: number | string | Prisma.Decimal) {
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

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2);
}

function orderTotal(items: Array<{ quantity: number | Prisma.Decimal; unitPrice: Prisma.Decimal | number | string }>) {
  return money(items.reduce((sum, item) => {
    const quantity = decimal(item.quantity as any);
    const unitPrice = decimal(item.unitPrice as any);
    return sum.plus(quantity.times(unitPrice));
  }, new Prisma.Decimal(0)));
}

export async function createOrder(input: {
  branchId: string;
  customerId?: string;
  channel: OrderChannelInput;
  items: OrderItemInput[];
}) {
  if (!input.branchId) throw new Error("ORDER_BRANCH_REQUIRED");
  if (!input.items.length) throw new Error("ORDER_ITEMS_REQUIRED");

  const branch = await prisma.branch.findUnique({ where: { id: input.branchId } });
  if (!branch) throw new Error("ORDER_BRANCH_NOT_FOUND");

  if (input.customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.organizationId !== branch.organizationId) throw new Error("ORDER_CUSTOMER_INVALID");
  }

  const preparedItems = [] as Array<{ productId: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }>;
  for (const item of input.items) {
    const quantity = positiveDecimal(item.quantity, "ORDER_QUANTITY_INVALID");
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      include: { branchProducts: { where: { branchId: input.branchId } }, prices: { where: { branchId: input.branchId }, orderBy: { effectiveAt: "desc" }, take: 1 } },
    });
    if (!product || product.organizationId !== branch.organizationId || product.status !== "ACTIVE") throw new Error("ORDER_PRODUCT_INVALID");
    if (!product.branchProducts[0]?.isEnabled) throw new Error("ORDER_PRODUCT_NOT_AVAILABLE");
    const configuredPrice = product.prices[0]?.price ?? product.publicPrice;
    const unitPrice = positiveDecimal(configuredPrice as any, "ORDER_PRICE_INVALID");
    preparedItems.push({ productId: product.id, quantity, unitPrice });
  }

  const total = orderTotal(preparedItems);
  const orderId = randomUUID();

  return prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        id: orderId,
        branchId: input.branchId,
        organizationId: branch.organizationId,
        customerId: input.customerId || null,
        channel: input.channel,
        status: "RECEIVED",
        total,
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
        beforeData: Prisma.JsonNull,
        afterData: {
          orderId: created.id,
          channel: input.channel,
          customerId: input.customerId || null,
          total: total.toFixed(2),
        },
      },
    });

    return { ...created, total: total.toFixed(2) };
  });
}

export async function listOrders(input: { branchId: string; status?: OrderStatusInput }) {
  const orders = await prisma.order.findMany({
    where: { branchId: input.branchId, ...(input.status ? { status: input.status } : {}) },
    include: { items: { include: { product: true } }, customer: true },
    orderBy: { createdAt: "desc" },
  });
  return orders.map((order) => ({ ...order, total: orderTotal(order.items).toFixed(2) }));
}

export async function transitionOrder(input: {
  branchId: string;
  orderId: string;
  status: OrderStatusInput;
  preparedById?: string;
}) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order || order.branchId !== input.branchId) throw new Error("ORDER_NOT_FOUND");
  if (!transitions[order.status as OrderStatusInput]?.includes(input.status)) throw new Error("ORDER_TRANSITION_INVALID");
  if (input.status === "COMPLETED" && !order.saleId) throw new Error("ORDER_SALE_REQUIRED");

  if (input.preparedById) {
    const user = await prisma.user.findUnique({ where: { id: input.preparedById }, include: { branchAccess: true } });
    if (!user || user.status !== "ACTIVE" || !user.branchAccess.some((access) => access.branchId === input.branchId)) throw new Error("ORDER_USER_INVALID");
  }

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch) throw new Error("ORDER_BRANCH_NOT_FOUND");
    const updated = await tx.order.update({
      where: { id: input.orderId },
      data: { status: input.status, preparedById: input.preparedById || undefined },
      include: { items: true, customer: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: branch.organizationId,
        branchId: input.branchId,
        action: `ORDER_${input.status}`,
        entityType: "Order",
        entityId: input.orderId,
        beforeData: { status: order.status },
        afterData: { status: input.status },
      },
    });
    return updated;
  });
}

export async function attachSaleToOrder(input: { branchId: string; orderId: string; saleId: string }) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order || order.branchId !== input.branchId) throw new Error("ORDER_NOT_FOUND");
  if (order.saleId) throw new Error("ORDER_SALE_ALREADY_LINKED");

  const sale = await prisma.sale.findUnique({ where: { id: input.saleId } });
  if (!sale || sale.branchId !== input.branchId || sale.status !== "COMPLETED") throw new Error("ORDER_SALE_INVALID");
  if (order.customerId && sale.customerId && order.customerId !== sale.customerId) throw new Error("ORDER_CUSTOMER_MISMATCH");

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch) throw new Error("ORDER_BRANCH_NOT_FOUND");
    const updated = await tx.order.update({
      where: { id: input.orderId },
      data: { saleId: input.saleId },
      include: { items: true, customer: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: branch.organizationId,
        branchId: input.branchId,
        action: "ORDER_LINKED_TO_SALE",
        entityType: "Order",
        entityId: input.orderId,
        beforeData: { saleId: order.saleId },
        afterData: { saleId: input.saleId },
      },
    });
    return updated;
  });
}
