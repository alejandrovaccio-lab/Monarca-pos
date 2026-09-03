import { login, logout } from "../core/auth";
import { requireSession } from "../middleware/auth";

export type LoginRequest = { email: string; password: string; branchId?: string };
export type ApiResponse<T> = { status: number; body: T };

export async function postLogin(request: LoginRequest): Promise<ApiResponse<unknown>> {
  if (!request?.email || !request?.password) return { status: 400, body: { error: "INVALID_REQUEST", message: "Email and password are required." } };
  const result = await login(request.email, request.password, request.branchId);
  if (!result.ok) {
    if (result.reason === "BRANCH_SELECTION_REQUIRED") return { status: 409, body: { error: result.reason, message: "Select a branch to continue.", branches: result.branches } };
    if (result.reason === "NO_BRANCH_ACCESS") return { status: 403, body: { error: result.reason, message: "No branch access is assigned." } };
    return { status: 401, body: { error: "INVALID_CREDENTIALS", message: "Invalid credentials." } };
  }
  return { status: 200, body: { sessionId: result.sessionId, token: result.token, expiresAt: result.expiresAt, branch: result.branch, roles: result.roles } };
}

export async function postLogout(token: string): Promise<ApiResponse<unknown>> {
  if (!token) return { status: 401, body: { error: "UNAUTHENTICATED" } };
  await logout(token);
  return { status: 204, body: null };
}

export async function getMe(token: string): Promise<ApiResponse<unknown>> {
  const context = await requireSession(token);
  if (!context) return { status: 401, body: { error: "UNAUTHENTICATED" } };
  return { status: 200, body: { sessionId: context.sessionId, user: { id: context.user.id, name: context.user.name, email: context.user.email, status: context.user.status }, branch: context.branch ? { id: context.branch.id, name: context.branch.name, code: context.branch.code, timezone: context.branch.timezone } : null, roles: context.roles } };
}