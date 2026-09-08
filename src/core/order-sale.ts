import { Prisma } from "@prisma/client";
import { createSale, type SalePaymentInput } from "./sales-create";
import { prisma } from "../lib/prisma";

function decimal(value: Prisma.Decimal | number | string) {
  return new Prisma.Decimal(String(value));
}

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2);
}

export async function createSaleFromOrder(input: {
  branchId: string;
  orderId: string;
  registerSessionId: string;
  cashierId: string;
  sellerId?: string;
  payments: SalePaymentInput[];
  soldAt?: string | Date;
}) {
  if (!input.branchId || !input.orderId || !input.registerSessionId || !input.cashierId) throw new Error("ORDER_SALE_CONTEXT_REQUIRED");
  if (!input.payments.length) throw new Error("SALE_PAYMENTS_REQUIRED");

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, customer: true },
    });
    if (!order || order.branchId !== input.branchId) throw new Error("ORDER_NOT_FOUND");
    if (order.status !== "READY") throw new Error("ORDER_NOT_READY_FOR_SALE");
    if (order.saleId) throw new Error("ORDER_ALREADY_HAS_SALE");

    const effectiveItems = order.items.map((item) => {
      if (item.unitPrice === null) throw new Error("ORDER_ITEM_PRICE_MISSING");
      return {
        productId: item.productId,
        quantity: item.actualQuantity ?? item.quantity,
        unitPrice: item.unitPrice,
      };
    });

    const expectedTotal = money(
      effectiveItems.reduce(
        (sum, item) => sum.add(decimal(item.quantity).mul(decimal(item.unitPrice))),
        new Prisma.Decimal(0),
      ),
    );

    const paidTotal = money(
      input.payments.reduce(
        (sum, payment) => sum.add(decimal(payment.amount)),
        new Prisma.Decimal(0),
      ),
    );
    if (!paidTotal.eq(expectedTotal)) throw new Error("ORDER_PAYMENT_TOTAL_MISMATCH");

    const sale = await createSale(
      {
        branchId: input.branchId,
        registerSessionId: input.registerSessionId,
        cashierId: input.cashierId,
        sellerId: input.sellerId,
        customerId: order.customerId ?? undefined,
        soldAt: input.soldAt,
        items: effectiveItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
        })),
        payments: input.payments,
      },
      tx,
    );

    if (sale.total !== expectedTotal.toFixed(2)) throw new Error("ORDER_SALE_TOTAL_MISMATCH");

    const linked = await tx.order.updateMany({
      where: { id: order.id, branchId: input.branchId, status: "READY", saleId: null },
      data: { saleId: sale.id, status: "PAID" },
    });
    if (linked.count !== 1) throw new Error("ORDER_CHANGED_DURING_SALE");

    const branch = await tx.branch.findUnique({
      where: { id: input.branchId },
      select: { organizationId: true },
    });
    if (branch) {
      await tx.auditLog.create({
        data: {
          organizationId: branch.organizationId,
          branchId: input.branchId,
          userId: input.cashierId,
          action: "ORDER_PAID",
          entityType: "Order",
          entityId: order.id,
          beforeData: { status: order.status, saleId: order.saleId },
          afterData: { status: "PAID", saleId: sale.id },
        },
      });
    }

    const paidOrder = await tx.order.findUnique({
      where: { id: order.id },
      include: { items: true, customer: true },
    });

    return {
      order: paidOrder,
      sale,
      usedQuantities: effectiveItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity.toString(),
      })),
    };
  });
}
