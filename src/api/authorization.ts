import { requestAuthorization, resolveAuthorization } from "../core/authorization";

function authorizationError(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
  const status = code === "AUTHORIZATION_APPROVER_REQUIRED" || code === "AUTHORIZATION_REQUESTER_REQUIRED" || code === "AUTHORIZATION_SCOPE_FORBIDDEN" || code === "SELF_APPROVAL_NOT_ALLOWED" ? 403
    : code === "AUTHORIZATION_NOT_FOUND" ? 404
    : code === "AUTHORIZATION_ALREADY_RESOLVED" || code === "AUTHORIZATION_INTEGRITY_VIOLATION" || code === "AUTHORIZATION_TARGET_INVALID" ? 409
    : code === "AUTHORIZATION_TYPE_INVALID" || code === "AUTHORIZATION_REASON_REQUIRED" || code === "AUTHORIZATION_ENTITY_REQUIRED" || code === "AUTHORIZATION_DECISION_INVALID" ? 400
    : 500;
  return { status, body: { error: code } };
}

export async function postAuthorizationRequest(input: Parameters<typeof requestAuthorization>[0]) {
  try {
    const request = await requestAuthorization(input);
    return { status: 201, body: request };
  } catch (error) {
    return authorizationError(error);
  }
}

export async function postAuthorizationDecision(input: Parameters<typeof resolveAuthorization>[0]) {
  try {
    const result = await resolveAuthorization(input);
    return { status: 200, body: result };
  } catch (error) {
    return authorizationError(error);
  }
}
