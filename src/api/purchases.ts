import { executeApprovedPurchaseReceipt, requestPurchaseReceipt } from "../core/purchases";
import { getAuthenticatedContext } from "../core/auth-context";

export async function postPurchaseRequest(input: Parameters<typeof requestPurchaseReceipt>[0]) {
  try {
    const auth = getAuthenticatedContext();
    const securedInput = auth ? { ...input, branchId: auth.branchId, requestedById: auth.userId } : input;
    return { status: 201, body: await requestPurchaseReceipt(securedInput) };
  } catch (error) {
    return mapPurchaseError(error);
  }
}

export async function postPurchaseExecution(input: Parameters<typeof executeApprovedPurchaseReceipt>[0]) {
  try {
    const auth = getAuthenticatedContext();
    const securedInput = auth ? { ...input, executorId: auth.userId } : input;
    return { status: 200, body: await executeApprovedPurchaseReceipt(securedInput) };
  } catch (error) {
    return mapPurchaseError(error);
  }
}

function mapPurchaseError(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
  const knownClientError = [
    "AUTHORIZATION_APPROVER_REQUIRED",
    "AUTHORIZATION_ENTITY_INVALID",
    "AUTHORIZATION_TARGET_INVALID",
    "AUTHORIZATION_SCOPE_FORBIDDEN",
    "REQUESTER_BRANCH_INVALID",
    "BRANCH_NOT_FOUND",
    "SUPPLIER_BRANCH_INVALID",
    "EMPLOYEE_BRANCH_INVALID",
    "PURCHASE_PRODUCT_INVALID",
    "PURCHASE_ITEMS_REQUIRED",
    "AUTHORIZATION_NOT_FOUND",
    "AUTHORIZATION_NOT_APPROVED",
    "PURCHASE_ALREADY_EXECUTED",
    "AUTHORIZATION_REASON_REQUIRED",
    "PURCHASE_FOLIO_REQUIRED",
    "PURCHASE_ITEM_INVALID",
    "PURCHASE_UNIT_COST_INVALID",
    "PURCHASE_TAX_RATE_INVALID",
    "PURCHASE_DATE_INVALID",
  ].includes(code);

  if (!knownClientError) {
    return { status: 500, body: { error: "INTERNAL_SERVER_ERROR" } };
  }

  const status = [
    "AUTHORIZATION_APPROVER_REQUIRED",
    "AUTHORIZATION_ENTITY_INVALID",
    "AUTHORIZATION_TARGET_INVALID",
    "AUTHORIZATION_SCOPE_FORBIDDEN",
    "REQUESTER_BRANCH_INVALID",
  ].includes(code) ? 403
    : ["BRANCH_NOT_FOUND", "SUPPLIER_BRANCH_INVALID", "EMPLOYEE_BRANCH_INVALID", "PURCHASE_PRODUCT_INVALID", "PURCHASE_ITEMS_REQUIRED"].includes(code) ? 400
    : ["AUTHORIZATION_NOT_FOUND"].includes(code) ? 404
    : ["AUTHORIZATION_NOT_APPROVED", "PURCHASE_ALREADY_EXECUTED"].includes(code) ? 409
    : 400;
  return { status, body: { error: code } };
}
