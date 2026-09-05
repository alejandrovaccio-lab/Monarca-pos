import { getSaleTicket } from "../core/sales-ticket";
import { formatSaleTicketForThermal } from "../core/sales-ticket-print";

export async function getSaleTicketPrintQuery(input: { saleId: string; branchId: string }) {
  try {
    const ticket = await getSaleTicket(input);
    return {
      status: 200,
      body: {
        type: "SALE_TICKET_THERMAL",
        folio: ticket.folio,
        contentType: "text/plain; charset=utf-8",
        width: 42,
        content: formatSaleTicketForThermal(ticket),
      },
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const statusByCode: Record<string, number> = {
      SALE_TICKET_CONTEXT_REQUIRED: 400,
      SALE_NOT_FOUND: 404,
      SALE_BRANCH_INVALID: 403,
    };
    return { status: statusByCode[code] ?? 500, body: { error: code } };
  }
}
