import { executeApprovedCashMovement, listCashMovements, requestCashMovement } from "../core/cash-movements";

type RequestInput = {
  sessionId: string;
  requestedById: string;
  type: "CASH_IN" | "CASH_OUT";
  amount: number;
  reason: string;
};

type ExecuteInput = {
  authorizationRequestId: string;
  executedById: string;
};

export async function postCashMovementRequest(input: RequestInput) {
  try {
    return { status: 201, body: await requestCashMovement(input) };
  } catch (error) {
    return mapCashMovementError(error);
  }
}

export async function postCashMovementExecution(input: ExecuteInput) {
  try {
    return { status: 200, body: await executeApprovedCashMovement(input) };
  } catch (error) {
    return mapCashMovementError(error);
  }
}

export async function getCashMovements(input: { sessionId: string; requestedById: string }) {
  try {
    return { status: 200, body: await listCashMovements(input) };
  } catch (error) {
    return mapCashMovementError(error);
  }
}

function mapCashMovementError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const statusByCode: Record<string, number> = {
    CASH_MOVEMENT_AMOUNT_INVALID: 400,
    CASH_MOVEMENT_TYPE_INVALID: 400,
    CASH_MOVEMENT_REASON_REQUIRED: 400,
    CASH_MOVEMENT_DATA_INVALID: 400,
    CASH_MOVEMENT_AUTHORIZATION_TYPE_INVALID: 409,
    AUTHORIZATION_NOT_APPROVED: 409,
    AUTHORIZATION_NOT_FOUND: 404,
    REGISTER_SESSION_NOT_FOUND: 404,
    REGISTER_SESSION_ALREADY_CLOSED: 409,
    CASH_MOVEMENT_BRANCH_INVALID: 403,
    USER_NOT_AUTHORIZED: 403,
    BRANCH_ACCESS_REQUIRED: 403,
  };
  return { status: statusByCode[code] ?? 500, body: { error: code } };
}
