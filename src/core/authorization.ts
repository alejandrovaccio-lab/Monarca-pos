import { prisma } from "../lib/prisma";

export const APPROVER_ROLES = new Set(["ENCARGADO_TIENDA", "GERENTE", "ADMIN", "SUPER_ADMIN"]);

export async function hasPermission(userId: string, permissionCode: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
  });
  return !!user?.roles.some(({ role }) => role.permissions.some(({ permission }) => permission.code === permissionCode));
}

export async function canApproveAuthorization(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  return !!user?.roles.some(({ role }) => APPROVER_ROLES.has(role.name));
}

export async function requestAuthorization(input: {
  organizationId: string; branchId?: string; requestedById: string; type: string; reason: string;
  entityType: string; entityId?: string; beforeData?: unknown; requestedData?: unknown;
}) {
  return prisma.authorizationRequest.create({ data: {
    organizationId: input.organizationId, branchId: input.branchId, requestedById: input.requestedById,
    type: input.type as any, reason: input.reason, entityType: input.entityType, entityId: input.entityId,
    beforeData: input.beforeData as any, requestedData: input.requestedData as any
  }});
}

export async function resolveAuthorization(input: {
  requestId: string; approverId: string; decision: "APPROVED" | "REJECTED"; notes?: string;
}) {
  if (!(await canApproveAuthorization(input.approverId))) throw new Error("AUTHORIZATION_APPROVER_REQUIRED");

  const request = await prisma.authorizationRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (request.requestedById === input.approverId) throw new Error("SELF_APPROVAL_NOT_ALLOWED");
  if (request.status !== "PENDING") throw new Error("AUTHORIZATION_ALREADY_RESOLVED");

  const status = input.decision;
  return prisma.$transaction(async (tx) => {
    const approval = await tx.authorizationApproval.create({ data: {
      authorizationRequestId: request.id,
      approverId: input.approverId,
      decision: status,
      notes: input.notes
    }});
    const resolved = await tx.authorizationRequest.update({
      where: { id: request.id }, data: { status, resolvedAt: new Date() }
    });
    await tx.auditLog.create({ data: {
      organizationId: request.organizationId, branchId: request.branchId, userId: input.approverId,
      action: `AUTHORIZATION_${status}`, entityType: request.entityType, entityId: request.entityId,
      beforeData: request.beforeData, afterData: request.requestedData
    }});
    return { approval, request: resolved };
  });
}
