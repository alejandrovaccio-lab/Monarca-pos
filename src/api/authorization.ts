import { requestAuthorization, resolveAuthorization } from "../core/authorization";

const CLIENT_ERROR_CODES = new Set([
  "AUTHORIZATION_APPROVER_REQUIRED",
  "AUTHORIZATION_CRITICAL_APPROVER_REQUIRED",
  "AUTHORIZATION_REQUESTER_REQUIRED",
  "AUTHORIZATION_SCOPE_FORBIDDEN",
  "SELF_APPROVAL_NOT_ALLOWED",
  "AUTHORIZATION_NOT_FOUND",
  "AUTHORIZATION_ALREADY_RESOLVED",
  "AUTHORIZATION_INTEGRITY_VIOLATION",
  "AUTHORIZATION_TARGET_INVALID",
  "AUTHORIZATION_TYPE_INVALID",
  "AUTHORIZATION_REASON_REQUIRED",
  "AUTHORIZATION_REASON_TOO_LONG",
  "AUTHORIZATION_ENTITY_REQUIRED",
  "AUTHORIZATION_ENTITY_TYPE_TOO_LONG",
  "AUTHORIZATION_DECISION_INVALID",
  "AUTHORIZATION_NOTES_TOO_LONG",
  "AUTHORIZATION_ORGANIZATION_INVALID",
  "AUTHORIZATION_BRANCH_INVALID",
  "AUTHORIZATION_REQUESTER_INVALID",
  "AUTHORIZATION_ENTITY_ID_INVALID",
  "AUTHORIZATION_REQUEST_ID_INVALID",
  "AUTHORIZATION_APPROVER_ID_INVALID"
]);

function authorizationError(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
  if (!CLIENT_ERROR_CODES.has(code)) {
    return { status: 500, body: { error: "INTERNAL_SERVER_ERROR" } };
  }

  const status = code === "AUTHORIZATION_APPROVER_REQUIRED" || code === "AUTHORIZATION_CRITICAL_APPROVER_REQUIRED" || code === "AUTHORIZATION_REQUESTER_REQUIRED" || code === "AUTHORIZATION_SCOPE_FORBIDDEN" || code === "SELF_APPROVAL_NOT_ALLOWED" ? 403
    : code === "AUTHORIZATION_NOT_FOUND" ? 404
    : code === "AUTHORIZATION_ALREADY_RESOLVED" || code === "AUTHORIZATION_INTEGRITY_VIOLATION" || code === "AUTHORIZATION_TARGET_INVALID" ? 409
    : 400;
  return { status, body: { error: code } };
}

function isRequestBodyObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export async function postAuthorizationRequest(input: Parameters<typeof requestAuthorization>[0]) {
  if (!isRequestBodyObject(input)) {
    return { status: 400, body: { error: "INVALID_REQUEST" } };
  }

  try {
    const request = await requestAuthorization(input);
    return { status: 201, body: request };
  } catch (error) {
    return authorizationError(error);
  }
}

export async function postAuthorizationDecision(input: Parameters<typeof resolveAuthorization>[0]) {
  if (!isRequestBodyObject(input)) {
    return { status: 400, body: { error: "INVALID_REQUEST" } };
  }

  try {
    const result = await resolveAuthorization(input);
    return { status: 200, body: result };
  } catch (error) {
    return authorizationError(error);
  }
}
