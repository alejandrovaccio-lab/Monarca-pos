import { prisma } from "../lib/prisma";

export const APPROVER_ROLES = new Set(["ENCARGADO_TIENDA", "GERENTE", "ADMIN", "SUPER_ADMIN"]);

export async function hasPermission(userId: string, permissionCode: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
  });
  if (!user || user.status === "INACTIVE") return false;
  return !!user.roles.some(({ role }) => role.permissions.some(({ permission }) => permission.code === permissionCode));
}

export async function canApproveAuthorization(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  if (!user || user.status === "INACTIVE") return false;
  return user.roles.some(({ role }) => APPROVER_ROLES.has(role.name));
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
  const approver = await prisma.user.findUnique({
    where: { id: input.approverId },
    include: {
      roles: { include: { role: true } },
      branchAccess: true
    }
  });
  if (!approver || approver.status === "INACTIVE" || !approver.roles.some(({ role }) => APPROVER_ROLES.has(role.name))) {
    throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
  }

  const request = await prisma.authorizationRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (request.requestedById === input.approverId) throw new Error("SELF_APPROVAL_NOT_ALLOWED");
  if (request.status !== "PENDING") throw new Error("AUTHORIZATION_ALREADY_RESOLVED");

  if (approver.organizationId !== request.organizationId) {
    throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
  }
  if (request.branchId && !approver.branchAccess.some(({ branchId }) => branchId === request.branchId)) {
    throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
  }

  const status = input.decision;
  return prisma.$transaction(async (tx) => {
    // Atomically claim the pending request. The unique id plus PENDING status
    // condition prevents a second concurrent approver from resolving it.
    let claimed;
    try {
      claimed = await tx.authorizationRequest.update({
        where: { id: request.id, status: "PENDING" },
        data: { status, resolvedAt: new Date() }
      });
    } catch (error: any) {
      if (error?.code === "P2025") throw new Error("AUTHORIZATION_ALREADY_RESOLVED");
      throw error;
    }

    const approval = await tx.authorizationApproval.create({ data: {
      authorizationRequestId: request.id,
      approverId: input.approverId,
      decision: status,
      notes: input.notes
    }});
    await tx.auditLog.create({ data: {
      organizationId: request.organizationId, branchId: request.branchId, userId: input.approverId,
      action: `AUTHORIZATION_${status}`, entityType: request.entityType, entityId: request.entityId,
      beforeData: request.beforeData == null ? undefined : request.beforeData,
      afterData: request.requestedData == null ? undefined : request.requestedData
    }});

    return { approval, request: claimed };
  });
}
