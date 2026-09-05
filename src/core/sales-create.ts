import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";

export type SaleItemInput = {
  productId: string;
  quantity: number | string;
  unitPrice?: number | string;
  taxRate?: number | string;
};

export type SalePaymentInput = {
  method: "CASH" | "CARD" | "TRANSFER" | "OTHER";
  amount: number | string;
};

const PAYMENT_METHODS = new Set<SalePaymentInput["method"]>(["CASH", "CARD", "TRANSFER", "OTHER"]);

function decimal(value: number | string) {
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    throw new Error("SALE_AMOUNT_INVALID");
  }
}

function positiveDecimal(value: number | string, errorCode: string) {
  const result = decimal(value);
  if (!result.isFinite() || result.lte(0)) throw new Error(errorCode);
  return result;
}

function nonNegativeDecimal(value: number | string, errorCode: string) {
  const result = decimal(value);
  if (!result.isFinite() || result.lt(0)) throw new Error(errorCode);
  return result;
}

function roundMoney(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2);
}

function generateFolio() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `V-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createSale(input: {
  branchId: string;
  registerSessionId: string;
  cashierId: string;
  sellerId?: string;
  customerId?: string;
  folio?: string;
  soldAt?: string | Date;
  items: SaleItemInput[];
  payments: SalePaymentInput[];
}) {
  if (!input.branchId || !input.registerSessionId || !input.cashierId) throw new Error("SALE_CONTEXT_REQUIRED");
  if (!input.items.length) throw new Error("SALE_ITEMS_REQUIRED");
  if (!input.payments.length) throw new Error("SALE_PAYMENTS_REQUIRED");

  const soldAt = input.soldAt ? new Date(input.soldAt) : new Date();
  if (Number.isNaN(soldAt.getTime())) throw new Error("SALE_DATE_INVALID");

  const [branch, session, cashier, seller, customer] = await Promise.all([
    prisma.branch.findUnique({ where: { id: input.branchId }, select: { id: true, organizationId: true } }),
    prisma.registerSession.findUnique({
      where: { id: input.registerSessionId },
      select: { id: true, closedAt: true, register: { select: { branchId: true, status: true } } },
    }),
    prisma.user.findUnique({
      where: { id: input.cashierId },
      select: { id: true, organizationId: true, status: true, branchAccess: { where: { branchId: input.branchId }, select: { branchId: true } } },
    }),
    input.sellerId
      ? prisma.user.findUnique({
          where: { id: input.sellerId },
          select: { id: true, organizationId: true, status: true, branchAccess: { where: { branchId: input.branchId }, select: { branchId: true } } },
        })
      : null,
    input.customerId
      ? prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true, organizationId: true } })
      : null,
  ]);

  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  if (!session || session.register.branchId !== branch.id) throw new Error("REGISTER_SESSION_INVALID");
  if (session.closedAt || session.register.status !== "OPEN") throw new Error("REGISTER_SESSION_CLOSED");
  if (!cashier || cashier.status !== "ACTIVE" || cashier.organizationId !== branch.organizationId) throw new Error("CASHIER_NOT_AUTHORIZED");
  if (!cashier.branchAccess.length) throw new Error("BRANCH_ACCESS_REQUIRED");
  if (input.sellerId && (!seller || seller.status !== "ACTIVE" || seller.organizationId !== branch.organizationId || !seller.branchAccess.length)) {
    throw new Error("SELLER_NOT_AUTHORIZED");
  }
  if (input.customerId && (!customer || customer.organizationId !== branch.organizationId)) throw new Error("CUSTOMER_INVALID");

  const preparedItems: Array<{
    productId: string;
    productName: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    discount: Prisma.Decimal;
    taxRate: Prisma.Decimal | null;
    costSnapshot: Prisma.Decimal | null;
    lineTotal: Prisma.Decimal;
  }> = [];

  for (const item of input.items) {
    if (!item.productId) throw new Error("SALE_ITEM_INVALID");
    const quantity = positiveDecimal(item.quantity, "SALE_QUANTITY_INVALID");
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        status: true,
        publicPrice: true,
        branchProducts: { where: { branchId: input.branchId }, select: { isEnabled: true } },
        prices: { where: { branchId: input.branchId, effectiveAt: { lte: soldAt } }, orderBy: { effectiveAt: "desc" }, take: 1, select: { price: true } },
        costs: { where: { effectiveAt: { lte: soldAt } }, orderBy: { effectiveAt: "desc" }, take: 1, select: { cost: true } },
      },
    });
    if (!product || product.organizationId !== branch.organizationId || product.status !== "ACTIVE") throw new Error("PRODUCT_NOT_AVAILABLE");
    if (!product.branchProducts.length || !product.branchProducts[0].isEnabled) throw new Error("PRODUCT_NOT_AVAILABLE_AT_BRANCH");

    const configuredPrice = product.prices[0]?.price ?? product.publicPrice;
    if (!configuredPrice) throw new Error("PRICE_NOT_CONFIGURED");
    const unitPrice = positiveDecimal(configuredPrice.toString(), "SALE_PRICE_INVALID");
    if (item.unitPrice !== undefined && !unitPrice.eq(decimal(item.unitPrice))) throw new Error("PRICE_OVERRIDE_AUTHORIZATION_REQUIRED");

    const taxRate = item.taxRate === undefined ? null : nonNegativeDecimal(item.taxRate, "SALE_TAX_RATE_INVALID");
    if (taxRate && taxRate.gt(1)) throw new Error("SALE_TAX_RATE_INVALID");

    const discount = new Prisma.Decimal(0);
    const subtotal = quantity.mul(unitPrice).sub(discount);
    const tax = taxRate ? subtotal.mul(taxRate) : new Prisma.Decimal(0);
    const lineTotal = roundMoney(subtotal.add(tax));

    preparedItems.push({ productId: product.id, productName: product.name, quantity, unitPrice, discount, taxRate, costSnapshot: product.costs[0]?.cost ?? null, lineTotal });
  }

  const total = roundMoney(preparedItems.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0)));
  const preparedPayments = input.payments.map((payment) => {
    if (!PAYMENT_METHODS.has(payment.method)) throw new Error("PAYMENT_METHOD_INVALID");
    return { method: payment.method, amount: roundMoney(positiveDecimal(payment.amount, "PAYMENT_AMOUNT_INVALID")) };
  });
  const paid = roundMoney(preparedPayments.reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0)));
  if (!paid.eq(total)) throw new Error("PAYMENT_TOTAL_MISMATCH");

  const saleId = randomUUID();
  const folio = input.folio?.trim() || generateFolio();
  if (!folio) throw new Error("SALE_FOLIO_REQUIRED");

  return prisma.$transaction(async (tx) => {
    for (const item of preparedItems) {
      const changed = await tx.inventoryBalance.updateMany({
        where: { branchId: input.branchId, productId: item.productId, quantity: { gte: item.quantity } },
        data: { quantity: { decrement: item.quantity } },
      });
      if (changed.count !== 1) throw new Error("INSUFFICIENT_INVENTORY");

      await tx.inventoryMovement.create({
        data: {
          branchId: input.branchId,
          productId: item.productId,
          type: "SALE",
          quantity: item.quantity.neg(),
          unitCost: item.costSnapshot,
          referenceType: "SALE",
          referenceId: saleId,
          userId: input.cashierId,
          occurredAt: soldAt,
          notes: `Venta ${folio}`,
        },
      });
    }

    const sale = await tx.sale.create({
      data: {
        id: saleId,
        branchId: input.branchId,
        registerSessionId: input.registerSessionId,
        cashierId: input.cashierId,
        sellerId: input.sellerId || null,
        customerId: input.customerId || null,
        folio,
        status: "COMPLETED",
        soldAt,
        items: { create: preparedItems.map((item) => ({ productId: item.productId, productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, taxRate: item.taxRate, costSnapshot: item.costSnapshot })) },
        payments: { create: preparedPayments },
      },
      include: { items: true, payments: true },
    });

    await tx.auditLog.create({
      data: {
        organizationId: branch.organizationId,
        branchId: input.branchId,
        userId: input.cashierId,
        action: "SALE_COMPLETED",
        entityType: "Sale",
        entityId: sale.id,
        beforeData: { inventoryChanged: true },
        afterData: { saleId: sale.id, folio, cashierId: input.cashierId, sellerId: input.sellerId || null, customerId: input.customerId || null, total: total.toString(), paymentMethods: preparedPayments.map((payment) => payment.method) },
      },
    });

    return { ...sale, total: total.toString() };
  });
}
