import { prisma } from "../lib/prisma";

function money(value: unknown) {
  return Number(value ?? 0).toFixed(2);
}

export async function getSaleTicket(input: { saleId: string; branchId: string }) {
  if (!input.saleId || !input.branchId) throw new Error("SALE_TICKET_CONTEXT_REQUIRED");

  const sale = await prisma.sale.findUnique({
    where: { id: input.saleId },
    include: {
      branch: { select: { id: true, name: true, code: true, timezone: true } },
      registerSession: { include: { register: { select: { id: true, name: true, code: true } } } },
      cashier: { select: { id: true, name: true } },
      seller: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true, email: true, taxId: true } },
      items: true,
      payments: true,
    },
  });

  if (!sale) throw new Error("SALE_NOT_FOUND");
  if (sale.branchId !== input.branchId) throw new Error("SALE_BRANCH_INVALID");

  const subtotal = sale.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice) - Number(item.discount), 0);
  const tax = sale.items.reduce((sum, item) => {
    const base = Number(item.quantity) * Number(item.unitPrice) - Number(item.discount);
    return sum + (item.taxRate ? base * Number(item.taxRate) : 0);
  }, 0);
  const total = subtotal + tax;

  return {
    type: "SALE_TICKET",
    folio: sale.folio,
    status: sale.status,
    date: sale.soldAt.toISOString().slice(0, 10),
    time: sale.soldAt.toISOString().slice(11, 19),
    branch: sale.branch,
    register: {
      id: sale.registerSession.register.id,
      name: sale.registerSession.register.name,
      code: sale.registerSession.register.code,
      sessionId: sale.registerSession.id,
    },
    cashier: sale.cashier,
    seller: sale.seller,
    customer: sale.customer,
    items: sale.items.map((item) => {
      const base = Number(item.quantity) * Number(item.unitPrice) - Number(item.discount);
      const itemTax = item.taxRate ? base * Number(item.taxRate) : 0;
      return {
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity.toString(),
        unitPrice: money(item.unitPrice),
        discount: money(item.discount),
        taxRate: item.taxRate?.toString() ?? null,
        lineSubtotal: money(base),
        lineTax: money(itemTax),
        lineTotal: money(base + itemTax),
      };
    }),
    totals: { subtotal: money(subtotal), tax: money(tax), total: money(total) },
    payments: sale.payments.map((payment) => ({ id: payment.id, method: payment.method, amount: money(payment.amount) })),
  };
}
