import { executeApprovedPhysicalCount, requestPhysicalCount } from "../core/physical-counts";

export async function postPhysicalCountRequest(input: Parameters<typeof requestPhysicalCount>[0]) {
  try { return { status: 201, body: await requestPhysicalCount(input) }; }
  catch (error) { return mapPhysicalCountError(error); }
}

export async function postPhysicalCountExecution(input: Parameters<typeof executeApprovedPhysicalCount>[0]) {
  try { return { status: 200, body: await executeApprovedPhysicalCount(input) }; }
  catch (error) { return mapPhysicalCountError(error); }
}

function mapPhysicalCountError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const statusByCode: Record<string, number> = {
    BRANCH_NOT_FOUND: 404, PRODUCT_NOT_FOUND: 404, EMPLOYEE_NOT_FOUND: 404,
    PRODUCT_BRANCH_INVALID: 409, EMPLOYEE_BRANCH_INVALID: 409,
    COUNT_QUANTITY_INVALID: 400, AUTHORIZATION_APPROVER_REQUIRED: 403,
    AUTHORIZATION_NOT_FOUND: 404, AUTHORIZATION_NOT_APPROVED: 409,
    AUTHORIZATION_ENTITY_INVALID: 409, AUTHORIZATION_TARGET_INVALID: 409,
    INVENTORY_CHANGED_SINCE_REQUEST: 409,
  };
  return { status: statusByCode[code] ?? 500, body: { error: code } };
}
