import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { formatOrderTicketForThermal, type PrintableOrderTicket } from "../core/order-ticket-print";

function formatDate(value: Date) {
  return value.toISOString().replace("T", " ").slice(0, 19);
}

export async function getOrderTicketPrintQuery(input: { orderId: string; branchId: string }) {
  if (!input.orderId || !input.branchId) return { status: 400, body: { error: "ORDER_TICKET_CONTEXT_REQUIRED" } };

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      customer: { select: { name: true, phone: true } },
      preparedBy: { select: { name: true } },
      items: {
        include: { product: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order || order.branchId !== input.branchId) return { status: order ? 403 : 404, body: { error: order ? "ORDER_BRANCH_INVALID" : "ORDER_NOT_FOUND" } };

  const ticket: PrintableOrderTicket = {
    orderId: order.id,
    requestedAt: formatDate(order.requestedAt),
    channel: order.channel,
    status: order.status,
    branch: { name: order.branch.name, code: order.branch.code },
    customer: order.customer,
    preparedBy: order.preparedBy,
    items: order.items.map((item) => ({
      productName: item.product.name,
      requestedQuantity: item.quantity.toString(),
      actualQuantity: item.actualQuantity === null ? null : item.actualQuantity.toString(),
      unitPrice: item.unitPrice?.toFixed(2) ?? "0.00",
    })),
  };

  return {
    status: 200,
    body: {
      type: "ORDER_PICKUP_THERMAL",
      orderId: order.id,
      contentType: "text/plain; charset=utf-8",
      width: 42,
      content: formatOrderTicketForThermal(ticket),
    },
  };
}
