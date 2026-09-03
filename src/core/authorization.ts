import { prisma } from "../lib/prisma";

export const APPROVER_ROLES = new Set(["ENCARGADO_TIENDA", "GERENTE", "ADMIN", "SUPER_ADMIN"]);

export type AuthorizationDecision = "APPROVED" | "REJECTED";

export async function hasPermission(userId: string, permissionCode: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
  });
  return !!user?.roles.some(({ role }) =>
    role.permissions.some(({ permission }) => permission.code === permissionCode)
  );
}

export async function canApproveAuthorization(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } }
  });
  return !!user?.roles.some(({ role }) => APPROVER_ROLES.has(role.name));
}

export async function requestAuthorization(input: {
  organizationId: string;
  branchId?: string;
  requestedById: string;
  type: string;
  reason: string;
  entityType: string;
  entityId?: string;
  beforeData?: unknown;
  requestedData?: unknown;
}) {
  return prisma.authorizationRequest.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      requestedById: input.requestedById,
      type: input.type as any,
      reason: input.reason,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeData: input.beforeData as any,
      requestedData: input.requestedData as any
    }
  });
}
