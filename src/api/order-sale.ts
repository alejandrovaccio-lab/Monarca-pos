import { createSaleFromOrder } from "../core/order-sale";

export async function postCreateSaleFromOrder(input: Parameters<typeof createSaleFromOrder>[0]) {
  try {
    return { status: 201, body: await createSaleFromOrder(input) };
  } catch (error) {
    const code = error instanceof Error ? error.message : "ORDER_SALE_ERROR";
    const statusByCode: Record<string, number> = {
      ORDER_SALE_CONTEXT_REQUIRED: 400,
      SALE_PAYMENTS_REQUIRED: 400,
      ORDER_PAYMENT_TOTAL_MISMATCH: 400,
      ORDER_NOT_FOUND: 404,
      ORDER_NOT_READY_FOR_SALE: 409,
      ORDER_ALREADY_HAS_SALE: 409,
      ORDER_SALE_TOTAL_MISMATCH: 409,
      REGISTER_SESSION_INVALID: 409,
      REGISTER_SESSION_CLOSED: 409,
      INSUFFICIENT_INVENTORY: 409,
      PRICE_OVERRIDE_AUTHORIZATION_REQUIRED: 403,
      CASHIER_NOT_AUTHORIZED: 403,
      SELLER_NOT_AUTHORIZED: 403,
      BRANCH_ACCESS_REQUIRED: 403,
      CUSTOMER_INVALID: 400,
    };
    return { status: statusByCode[code] ?? 500, body: { error: code } };
  }
}
