import { getSaleTicket } from "../core/sales-ticket";

export async function getSaleTicketQuery(input: { saleId: string; branchId: string }) {
  try {
    return { status: 200, body: await getSaleTicket(input) };
  } catch (error) {
    return mapSaleTicketError(error);
  }
}

function mapSaleTicketError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const statusByCode: Record<string, number> = {
    SALE_TICKET_CONTEXT_REQUIRED: 400,
    SALE_NOT_FOUND: 404,
    SALE_BRANCH_INVALID: 403,
  };
  return { status: statusByCode[code] ?? 500, body: { error: code } };
}
