import { executeApprovedPurchaseReceipt, requestPurchaseReceipt } from "../core/purchases";

export async function postPurchaseRequest(input: Parameters<typeof requestPurchaseReceipt>[0]) {
  try {
    return { status: 201, body: await requestPurchaseReceipt(input) };
  } catch (error) {
    return mapPurchaseError(error);
  }
}

export async function postPurchaseExecution(input: Parameters<typeof executeApprovedPurchaseReceipt>[0]) {
  try {
    return { status: 200, body: await executeApprovedPurchaseReceipt(input) };
  } catch (error) {
    return mapPurchaseError(error);
  }
}

function mapPurchaseError(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
  const status = [
    "AUTHORIZATION_APPROVER_REQUIRED",
    "AUTHORIZATION_ENTITY_INVALID",
    "AUTHORIZATION_TARGET_INVALID",
    "REQUESTER_BRANCH_INVALID",
  ].includes(code) ? 403
    : ["BRANCH_NOT_FOUND", "SUPPLIER_BRANCH_INVALID", "EMPLOYEE_BRANCH_INVALID", "PURCHASE_PRODUCT_INVALID", "PURCHASE_ITEMS_REQUIRED"].includes(code) ? 400
    : ["AUTHORIZATION_NOT_FOUND"].includes(code) ? 404
    : ["AUTHORIZATION_NOT_APPROVED", "PURCHASE_ALREADY_EXECUTED"].includes(code) ? 409
    : [
      "AUTHORIZATION_REASON_REQUIRED",
      "PURCHASE_FOLIO_REQUIRED",
      "PURCHASE_ITEM_INVALID",
      "PURCHASE_UNIT_COST_INVALID",
      "PURCHASE_TAX_RATE_INVALID",
      "PURCHASE_DATE_INVALID",
    ].includes(code) ? 400
    : 500;
  return { status, body: { error: code } };
}
