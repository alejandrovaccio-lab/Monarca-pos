import { createSale, type SaleItemInput, type SalePaymentInput } from "../core/sales-create";

type CreateSaleInput = {
  branchId: string;
  registerSessionId: string;
  cashierId: string;
  sellerId?: string;
  customerId?: string;
  folio?: string;
  soldAt?: string | Date;
  items: SaleItemInput[];
  payments: SalePaymentInput[];
};

export async function postCreateSale(input: CreateSaleInput) {
  try {
    return { status: 201, body: await createSale(input) };
  } catch (error) {
    return mapCreateSaleError(error);
  }
}

function mapCreateSaleError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const statusByCode: Record<string, number> = {
    SALE_CONTEXT_REQUIRED: 400,
    SALE_ITEMS_REQUIRED: 400,
    SALE_PAYMENTS_REQUIRED: 400,
    SALE_DATE_INVALID: 400,
    SALE_ITEM_INVALID: 400,
    SALE_QUANTITY_INVALID: 400,
    SALE_PRICE_INVALID: 400,
    SALE_TAX_RATE_INVALID: 400,
    PAYMENT_METHOD_INVALID: 400,
    PAYMENT_AMOUNT_INVALID: 400,
    PAYMENT_TOTAL_MISMATCH: 400,
    SALE_FOLIO_REQUIRED: 400,
    PRICE_OVERRIDE_AUTHORIZATION_REQUIRED: 403,
    BRANCH_NOT_FOUND: 404,
    PRODUCT_NOT_AVAILABLE: 409,
    PRODUCT_NOT_AVAILABLE_AT_BRANCH: 409,
    PRICE_NOT_CONFIGURED: 409,
    REGISTER_SESSION_INVALID: 409,
    REGISTER_SESSION_CLOSED: 409,
    INSUFFICIENT_INVENTORY: 409,
    CASHIER_NOT_AUTHORIZED: 403,
    SELLER_NOT_AUTHORIZED: 403,
    BRANCH_ACCESS_REQUIRED: 403,
    CUSTOMER_INVALID: 400,
  };
  return { status: statusByCode[code] ?? 500, body: { error: code } };
}
