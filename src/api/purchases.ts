import { executeApprovedPurchaseReceipt, requestPurchaseReceipt } from "../core/purchases";
import { getAuthenticatedContext } from "../core/auth-context";

const MAX_PURCHASE_REQUEST_ID_LENGTH = 128;
const MAX_PURCHASE_REASON_LENGTH = 1000;
const MAX_PURCHASE_FOLIO_LENGTH = 128;
const MAX_PURCHASE_ITEMS = 100;

export async function postPurchaseRequest(input: Parameters<typeof requestPurchaseReceipt>[0]) {
  if (typeof input.reason !== "string" || input.reason.trim().length === 0 || input.reason.length > MAX_PURCHASE_REASON_LENGTH) {
    return { status: 400, body: { error: "PURCHASE_REASON_INVALID" } };
  }
  if (typeof input.folio !== "string" || input.folio.trim().length === 0 || input.folio.length > MAX_PURCHASE_FOLIO_LENGTH) {
    return { status: 400, body: { error: "PURCHASE_FOLIO_INVALID" } };
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > MAX_PURCHASE_ITEMS) {
    return { status: 400, body: { error: "PURCHASE_ITEMS_LIMIT_INVALID" } };
  }

  try {
    const auth = getAuthenticatedContext();
    const securedInput = auth ? { ...input, branchId: auth.branchId, requestedById: auth.userId } : input;
    return { status: 201, body: await requestPurchaseReceipt(securedInput) };
  } catch (error) {
    return mapPurchaseError(error);
  }
}

export async function postPurchaseExecution(input: Parameters<typeof executeApprovedPurchaseReceipt>[0]) {
  if (typeof input.requestId !== "string" || input.requestId.length === 0 || input.requestId.length > MAX_PURCHASE_REQUEST_ID_LENGTH) {
    return { status: 400, body: { error: "PURCHASE_REQUEST_ID_INVALID" } };
  }

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
    "PURCHASE_REASON_INVALID",
    "PURCHASE_FOLIO_INVALID",
    "PURCHASE_ITEMS_LIMIT_INVALID",
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
    : ["BRANCH_NOT_FOUND", "SUPPLIER_BRANCH_INVALID", "EMPLOYEE_BRANCH_INVALID", "PURCHASE_PRODUCT_INVALID", "PURCHASE_ITEMS_REQUIRED", "PURCHASE_REASON_INVALID", "PURCHASE_FOLIO_INVALID", "PURCHASE_ITEMS_LIMIT_INVALID"].includes(code) ? 400
    : ["AUTHORIZATION_NOT_FOUND"].includes(code) ? 404
    : ["AUTHORIZATION_NOT_APPROVED", "PURCHASE_ALREADY_EXECUTED"].includes(code) ? 409
    : 400;
  return { status, body: { error: code } };
}
