import { requestAuthorization, resolveAuthorization } from "../core/authorization";

export async function postAuthorizationRequest(input: Parameters<typeof requestAuthorization>[0]) {
  if (!input.reason?.trim()) return { status: 400, body: { error: "REASON_REQUIRED" } };
  const request = await requestAuthorization(input);
  return { status: 201, body: request };
}

export async function postAuthorizationDecision(input: Parameters<typeof resolveAuthorization>[0]) {
  try {
    const result = await resolveAuthorization(input);
    return { status: 200, body: result };
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    const status = code === "AUTHORIZATION_APPROVER_REQUIRED" || code === "SELF_APPROVAL_NOT_ALLOWED" ? 403
      : code === "AUTHORIZATION_NOT_FOUND" ? 404 : code === "AUTHORIZATION_ALREADY_RESOLVED" ? 409 : 500;
    return { status, body: { error: code } };
  }
}
