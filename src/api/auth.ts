import { login, logout } from "../core/auth";
import { requireSession } from "../middleware/auth";

export type LoginRequest = { email: string; password: string; branchId?: string };
export type ApiResponse<T> = { status: number; body: T };

const internalServerError = (): ApiResponse<{ error: string; message: string }> => ({
  status: 500,
  body: { error: "INTERNAL_SERVER_ERROR", message: "Internal server error." }
});

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function isLoginRequest(input: unknown): input is LoginRequest {
  if (!isPlainObject(input)) return false;
  return typeof input.email === "string"
    && input.email.trim().length > 0
    && typeof input.password === "string"
    && input.password.length > 0
    && (input.branchId === undefined || typeof input.branchId === "string");
}

function isToken(input: unknown): input is string {
  return typeof input === "string" && input.length > 0;
}

export async function postLogin(request: LoginRequest): Promise<ApiResponse<unknown>> {
  if (!isLoginRequest(request)) return { status: 400, body: { error: "INVALID_REQUEST", message: "Email and password are required." } };

  try {
    const result = await login(request.email, request.password, request.branchId);
    if (!result.ok) {
      if (result.reason === "BRANCH_SELECTION_REQUIRED") return { status: 409, body: { error: result.reason, message: "Select a branch to continue.", branches: result.branches } };
      if (result.reason === "NO_BRANCH_ACCESS" || result.reason === "BRANCH_ACCESS_DENIED") {
        return { status: 403, body: { error: result.reason, message: result.reason === "NO_BRANCH_ACCESS" ? "No branch access is assigned." : "You do not have access to this branch." } };
      }
      return { status: 401, body: { error: "INVALID_CREDENTIALS", message: "Invalid credentials." } };
    }
    return { status: 200, body: { sessionId: result.sessionId, token: result.token, expiresAt: result.expiresAt, branch: result.branch, roles: result.roles } };
  } catch {
    return internalServerError();
  }
}

export async function postLogout(token: string): Promise<ApiResponse<unknown>> {
  if (!isToken(token)) return { status: 401, body: { error: "UNAUTHENTICATED" } };
  try {
    const result = await logout(token);
    if (!result) return { status: 401, body: { error: "UNAUTHENTICATED" } };
    return { status: 204, body: null };
  } catch {
    return internalServerError();
  }
}

export async function getMe(token: string): Promise<ApiResponse<unknown>> {
  if (!isToken(token)) return { status: 401, body: { error: "UNAUTHENTICATED" } };

  try {
    const context = await requireSession(token);
    if (!context) return { status: 401, body: { error: "UNAUTHENTICATED" } };
    return { status: 200, body: { sessionId: context.sessionId, user: { id: context.user.id, name: context.user.name, email: context.user.email, status: context.user.status }, branch: context.branch ? { id: context.branch.id, name: context.branch.name, code: context.branch.code, timezone: context.branch.timezone } : null, roles: context.roles } };
  } catch {
    return internalServerError();
  }
}
