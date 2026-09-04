import { executeApprovedSaleChange, requestSaleChange, type SaleChangeType } from "../core/sales";

type RequestInput = {
  saleId: string;
  requestedById: string;
  type: SaleChangeType;
  reason: string;
};

export async function postSaleChangeAuthorization(input: RequestInput) {
  try {
    const authorization = await requestSaleChange(input);
    return { status: 201, body: authorization };
  } catch (error) {
    return mapSaleError(error);
  }
}

export async function postExecuteSaleChange(input: { requestId: string; executorId: string }) {
  try {
    const sale = await executeApprovedSaleChange(input);
    return { status: 200, body: sale };
  } catch (error) {
    return mapSaleError(error);
  }
}

function mapSaleError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const statusByCode: Record<string, number> = {
    AUTHORIZATION_REASON_REQUIRED: 400,
    SALE_NOT_FOUND: 404,
    BRANCH_NOT_FOUND: 404,
    AUTHORIZATION_NOT_FOUND: 404,
    SALE_NOT_ELIGIBLE_FOR_CHANGE: 409,
    SALE_ALREADY_CHANGED: 409,
    AUTHORIZATION_NOT_APPROVED: 409,
    AUTHORIZATION_ENTITY_INVALID: 409,
    AUTHORIZATION_BRANCH_INVALID: 409,
    AUTHORIZATION_TARGET_INVALID: 409,
    AUTHORIZATION_APPROVER_REQUIRED: 403,
  };
  return { status: statusByCode[code] ?? 500, body: { error: code } };
}
