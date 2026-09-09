import { executeApprovedInventoryAdjustment, requestInventoryAdjustment } from "../core/inventory-adjustments";

export async function postInventoryAdjustmentRequest(input: Parameters<typeof requestInventoryAdjustment>[0]) {
  try { return { status: 201, body: await requestInventoryAdjustment(input) }; }
  catch (error) { return mapInventoryAdjustmentError(error); }
}

export async function postInventoryAdjustmentExecution(input: Parameters<typeof executeApprovedInventoryAdjustment>[0]) {
  try { return { status: 200, body: await executeApprovedInventoryAdjustment(input) }; }
  catch (error) { return mapInventoryAdjustmentError(error); }
}

function mapInventoryAdjustmentError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const statusByCode: Record<string, number> = {
    AUTHORIZATION_REASON_REQUIRED: 400,
    INVENTORY_QUANTITY_INVALID: 400,
    BRANCH_NOT_FOUND: 404,
    PRODUCT_NOT_FOUND: 404,
    EMPLOYEE_NOT_FOUND: 404,
    AUTHORIZATION_NOT_FOUND: 404,
    AUTHORIZATION_APPROVER_REQUIRED: 403,
    AUTHORIZATION_SCOPE_FORBIDDEN: 403,
    PRODUCT_BRANCH_INVALID: 409,
    EMPLOYEE_BRANCH_INVALID: 409,
    INVENTORY_NEGATIVE_NOT_ALLOWED: 409,
    AUTHORIZATION_NOT_APPROVED: 409,
    AUTHORIZATION_ENTITY_INVALID: 409,
    AUTHORIZATION_TARGET_INVALID: 409,
    AUTHORIZATION_ALREADY_EXECUTED: 409,
    INVENTORY_CHANGED_SINCE_REQUEST: 409,
  };
  return { status: statusByCode[code] ?? 500, body: { error: code } };
}
