import { prisma } from "../lib/prisma";
import { canApproveAuthorization, hasPermission } from "../core/authorization";
import { requireBranchSession, requireSession } from "./auth";

export async function requirePermission(userId: string, permissionCode: string) {
  return hasPermission(userId, permissionCode);
}

export async function requireAuthorizationApprover(userId: string) {
  return canApproveAuthorization(userId);
}

export async function requireBranchPermission(
  token: string,
  branchId: string,
  permissionCode: string
) {
  const context = await requireBranchSession(token, branchId);
  if (!context) return null;

  const allowed = await hasPermission(context.userId, permissionCode);
  if (!allowed) return null;

  return context;
}

export async function requireBranchAuthorizationApprover(token: string, branchId: string) {
  const context = await requireBranchSession(token, branchId);
  if (!context) return null;

  const allowed = await canApproveAuthorization(context.userId);
  if (!allowed) return null;

  return context;
}

export async function requireAuthorizationDecisionApprover(token: string, requestId: string) {
  const context = await requireSession(token);
  if (!context) return null;

  const request = await prisma.authorizationRequest.findUnique({
    where: { id: requestId },
    select: { organizationId: true, branchId: true }
  });
  if (!request) return null;

  if (context.user.organizationId !== request.organizationId) return null;
  if (request.branchId && context.branchId !== request.branchId) return null;

  const allowed = await canApproveAuthorization(context.userId);
  if (!allowed) return null;

  return context;
}
