import {
  executeApprovedInventoryAdjustment,
  requestInventoryAdjustment,
  InventoryAdjustmentType,
} from "../core/inventory-adjustments";

export async function postInventoryAdjustmentAuthorization(input: {
  branchId: string;
  productId: string;
  requestedById: string;
  employeeId: string;
  type: InventoryAdjustmentType;
  quantity: number;
  reason: string;
  unitCost?: number;
}) {
  try {
    return { status: 201, body: await requestInventoryAdjustment(input) };
  } catch (error) {
    return mapInventoryError(error);
  }
}

export async function postExecuteInventoryAdjustment(input: {
  requestId: string;
  executorId: string;
}) {
  try {
    return { status: 200, body: await executeApprovedInventoryAdjustment(input) };
  } catch (error) {
    return mapInventoryError(error);
  }
}

function mapInventoryError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const statusByCode: Record<string, number> = {
    AUTHORIZATION_REASON_REQUIRED: 400,
    INVENTORY_QUANTITY_INVALID: 400,
    BRANCH_NOT_FOUND: 404,
    PRODUCT_NOT_FOUND: 404,
    EMPLOYEE_NOT_FOUND: 404,
    PRODUCT_BRANCH_INVALID: 409,
    EMPLOYEE_BRANCH_INVALID: 409,
    INVENTORY_NEGATIVE_NOT_ALLOWED: 409,
    INVENTORY_CHANGED_SINCE_REQUEST: 409,
    AUTHORIZATION_NOT_FOUND: 404,
    AUTHORIZATION_NOT_APPROVED: 409,
    AUTHORIZATION_ENTITY_INVALID: 409,
    AUTHORIZATION_TARGET_INVALID: 409,
    AUTHORIZATION_APPROVER_REQUIRED: 403,
  };
  return { status: statusByCode[code] ?? 500, body: { error: code } };
}
