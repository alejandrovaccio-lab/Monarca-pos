import { canApproveAuthorization, hasPermission } from "../core/authorization";

export async function requirePermission(userId: string, permissionCode: string) {
  return hasPermission(userId, permissionCode);
}

export async function requireAuthorizationApprover(userId: string) {
  return canApproveAuthorization(userId);
}
