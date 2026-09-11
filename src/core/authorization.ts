import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";

export const APPROVER_ROLES = new Set(["ENCARGADO_TIENDA", "GERENTE", "ADMIN", "SUPER_ADMIN"]);
export const CRITICAL_APPROVER_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

export const AUTHORIZATION_TYPES = new Set([
  "PRICE_CHANGE", "MARGIN_CHANGE", "DISCOUNT_EXCEPTION", "SALE_CANCEL", "SALE_REFUND",
  "INVENTORY_ADJUSTMENT", "WASTE_EXCEPTION", "SHRINKAGE_EXCEPTION", "COST_CHANGE", "TAX_CHANGE",
  "REGISTER_EXCEPTION", "ACCESS_CHANGE", "ORDER_ADJUSTMENT", "OTHER"
]);

const MAX_AUTHORIZATION_REASON_LENGTH = 1000;
const MAX_AUTHORIZATION_NOTES_LENGTH = 2000;
const MAX_AUTHORIZATION_IDENTIFIER_LENGTH = 128;
const MAX_AUTHORIZATION_ENTITY_TYPE_LENGTH = 64;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

export function authorizationIntegrityHash(input: {
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
  return createHash("sha256").update(canonicalize(input)).digest("hex");
}

function assertIdentifier(value: string | undefined, errorCode: string) {
  if (value !== undefined && (!value || value.length > MAX_AUTHORIZATION_IDENTIFIER_LENGTH)) throw new Error(errorCode);
}

function requiresCriticalApprover(type: string) {
  return type === "TAX_CHANGE" || type === "ACCESS_CHANGE";
}

function hasApproverRole(user: { roles: Array<{ role: { name: string } }> }, roles: Set<string>) {
  return user.roles.some(({ role }) => roles.has(role.name));
}

function assertApproverForType(user: { roles: Array<{ role: { name: string } }> }, type: string) {
  if (!hasApproverRole(user, APPROVER_ROLES)) throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
  if (requiresCriticalApprover(type) && !hasApproverRole(user, CRITICAL_APPROVER_ROLES)) {
    throw new Error("AUTHORIZATION_CRITICAL_APPROVER_REQUIRED");
  }
}

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
  return hasApproverRole(user, APPROVER_ROLES);
}

export async function requestAuthorization(input: {
  organizationId: string; branchId?: string; requestedById: string; type: string; reason: string;
  entityType: string; entityId?: string; beforeData?: unknown; requestedData?: unknown;
}) {
  if (!AUTHORIZATION_TYPES.has(input.type)) throw new Error("AUTHORIZATION_TYPE_INVALID");
  assertIdentifier(input.organizationId, "AUTHORIZATION_ORGANIZATION_INVALID");
  if (input.branchId !== undefined) assertIdentifier(input.branchId, "AUTHORIZATION_BRANCH_INVALID");
  assertIdentifier(input.requestedById, "AUTHORIZATION_REQUESTER_INVALID");
  if (input.entityId !== undefined) assertIdentifier(input.entityId, "AUTHORIZATION_ENTITY_ID_INVALID");
  const entityType = input.entityType?.trim() ?? "";
  if (!entityType) throw new Error("AUTHORIZATION_ENTITY_REQUIRED");
  if (entityType.length > MAX_AUTHORIZATION_ENTITY_TYPE_LENGTH) throw new Error("AUTHORIZATION_ENTITY_TYPE_TOO_LONG");

  const persistedReason = input.reason?.trim() ?? "";
  if (!persistedReason) throw new Error("AUTHORIZATION_REASON_REQUIRED");
  if (persistedReason.length > MAX_AUTHORIZATION_REASON_LENGTH) throw new Error("AUTHORIZATION_REASON_TOO_LONG");

  const requester = await prisma.user.findUnique({ where: { id: input.requestedById }, include: { branchAccess: true } });
  if (!requester || requester.status === "INACTIVE") throw new Error("AUTHORIZATION_REQUESTER_REQUIRED");
  if (requester.organizationId !== input.organizationId) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
  if (input.branchId && !requester.branchAccess.some(({ branchId }) => branchId === input.branchId)) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");

  const integrityHash = authorizationIntegrityHash({ ...input, reason: persistedReason, entityType });
  return prisma.authorizationRequest.create({ data: {
    organizationId: input.organizationId, branchId: input.branchId, requestedById: input.requestedById,
    type: input.type as any, reason: persistedReason, entityType, entityId: input.entityId,
    beforeData: input.beforeData as any, requestedData: input.requestedData as any, integrityHash
  }});
}

export async function resolveAuthorization(input: {
  requestId: string; approverId: string; decision: "APPROVED" | "REJECTED"; notes?: string;
}) {
  if (input.decision !== "APPROVED" && input.decision !== "REJECTED") throw new Error("AUTHORIZATION_DECISION_INVALID");
  assertIdentifier(input.requestId, "AUTHORIZATION_REQUEST_ID_INVALID");
  assertIdentifier(input.approverId, "AUTHORIZATION_APPROVER_ID_INVALID");
  const notes = input.notes?.trim();
  if (notes && notes.length > MAX_AUTHORIZATION_NOTES_LENGTH) throw new Error("AUTHORIZATION_NOTES_TOO_LONG");

  const approver = await prisma.user.findUnique({ where: { id: input.approverId }, include: { roles: { include: { role: true } }, branchAccess: true } });
  if (!approver || approver.status === "INACTIVE") throw new Error("AUTHORIZATION_APPROVER_REQUIRED");

  const request = await prisma.authorizationRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (request.requestedById === input.approverId) throw new Error("SELF_APPROVAL_NOT_ALLOWED");
  if (request.status !== "PENDING") throw new Error("AUTHORIZATION_ALREADY_RESOLVED");
  assertApproverForType(approver, request.type);
  if (approver.organizationId !== request.organizationId) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
  if (request.branchId && !approver.branchAccess.some(({ branchId }) => branchId === request.branchId)) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");

  return prisma.$transaction(async (tx) => {
    const currentApprover = await tx.user.findUnique({ where: { id: input.approverId }, include: { roles: { include: { role: true } }, branchAccess: true } });
    if (!currentApprover || currentApprover.status === "INACTIVE") throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
    if (currentApprover.organizationId !== request.organizationId) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
    if (request.branchId && !currentApprover.branchAccess.some(({ branchId }) => branchId === request.branchId)) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");

    const currentRequest = await tx.authorizationRequest.findUnique({ where: { id: request.id } });
    if (!currentRequest) throw new Error("AUTHORIZATION_NOT_FOUND");
    if (currentRequest.status !== "PENDING") throw new Error("AUTHORIZATION_ALREADY_RESOLVED");
    if (currentRequest.requestedById === input.approverId) throw new Error("SELF_APPROVAL_NOT_ALLOWED");
    if (currentRequest.organizationId !== request.organizationId || currentRequest.branchId !== request.branchId) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
    if (currentRequest.type !== request.type || currentRequest.reason !== request.reason || currentRequest.entityType !== request.entityType || currentRequest.entityId !== request.entityId || currentRequest.requestedById !== request.requestedById) {
      throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
    }
    assertApproverForType(currentApprover, currentRequest.type);
    const expectedIntegrityHash = authorizationIntegrityHash({
      organizationId: currentRequest.organizationId,
      branchId: currentRequest.branchId ?? undefined,
      requestedById: currentRequest.requestedById,
      type: currentRequest.type,
      reason: currentRequest.reason,
      entityType: currentRequest.entityType,
      entityId: currentRequest.entityId ?? undefined,
      beforeData: currentRequest.beforeData,
      requestedData: currentRequest.requestedData
    });
    if (currentRequest.integrityHash || request.integrityHash) {
      if (currentRequest.integrityHash !== expectedIntegrityHash || currentRequest.integrityHash !== request.integrityHash) {
        throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
      }
    }

    let claimed;
    try {
      claimed = await tx.authorizationRequest.update({ where: { id: currentRequest.id, status: "PENDING" }, data: { status: input.decision, resolvedAt: new Date() } });
    } catch (error: any) {
      if (error?.code === "P2025") throw new Error("AUTHORIZATION_ALREADY_RESOLVED");
      throw error;
    }

    const approval = await tx.authorizationApproval.create({ data: { authorizationRequestId: currentRequest.id, approverId: input.approverId, decision: input.decision, notes } });
    await tx.auditLog.create({ data: {
      organizationId: currentRequest.organizationId, branchId: currentRequest.branchId, userId: input.approverId,
      action: `AUTHORIZATION_${input.decision}`, entityType: currentRequest.entityType, entityId: currentRequest.entityId,
      beforeData: currentRequest.beforeData == null ? undefined : currentRequest.beforeData,
      afterData: currentRequest.requestedData == null ? undefined : currentRequest.requestedData
    }});
    return { approval, request: claimed };
  });
}
