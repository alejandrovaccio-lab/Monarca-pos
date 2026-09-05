import { closeRegisterSession, openRegisterSession } from "../core/registers";

type OpenInput = {
  branchId: string;
  registerId: string;
  openedById: string;
  openingFloat: number;
};

type CloseInput = {
  sessionId: string;
  closedById: string;
  closingTotal: number;
};

export async function postOpenRegister(input: OpenInput) {
  try {
    return { status: 201, body: await openRegisterSession(input) };
  } catch (error) {
    return mapRegisterError(error);
  }
}

export async function postCloseRegister(input: CloseInput) {
  try {
    return { status: 200, body: await closeRegisterSession(input) };
  } catch (error) {
    return mapRegisterError(error);
  }
}

function mapRegisterError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const statusByCode: Record<string, number> = {
    OPENING_FLOAT_INVALID: 400,
    CLOSING_TOTAL_INVALID: 400,
    BRANCH_NOT_FOUND: 404,
    REGISTER_NOT_FOUND: 404,
    REGISTER_SESSION_NOT_FOUND: 404,
    USER_NOT_AUTHORIZED: 403,
    BRANCH_ACCESS_REQUIRED: 403,
    REGISTER_ALREADY_OPEN: 409,
    REGISTER_SESSION_ALREADY_CLOSED: 409,
    REGISTER_STATE_INVALID: 409,
  };
  return { status: statusByCode[code] ?? 500, body: { error: code } };
}
