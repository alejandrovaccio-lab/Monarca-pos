import { prisma } from "../lib/prisma";
import { canApproveAuthorization, requestAuthorization, authorizationIntegrityHash } from "./authorization";

export type SaleChangeType = "SALE_CANCEL" | "SALE_REFUND";

const TARGET_STATUS = {
  SALE_CANCEL: "CANCELLED",
  SALE_REFUND: "REFUNDED",
} as const;

type SaleAuthorizationPayload = { id?: string; status?: string };

export async function requestSaleChange(input: {
  saleId: string;
  requestedById: string;
  type: SaleChangeType;
  reason: string;
}) {
  if (!input.reason.trim()) throw new Error("AUTHORIZATION_REASON_REQUIRED");
  if (input.type !== "SALE_CANCEL" && input.type !== "SALE_REFUND") throw new Error("AUTHORIZATION_TYPE_INVALID");

  const sale = await prisma.sale.findUnique({ where: { id: input.saleId } });
  if (!sale) throw new Error("SALE_NOT_FOUND");
  if (sale.status !== "COMPLETED") throw new Error("SALE_NOT_ELIGIBLE_FOR_CHANGE");

  const requestedStatus = TARGET_STATUS[input.type];
  return requestAuthorization({
    organizationId: await getSaleOrganizationId(sale.branchId),
    branchId: sale.branchId,
    requestedById: input.requestedById,
    type: input.type,
    reason: input.reason.trim(),
    entityType: "Sale",
    entityId: sale.id,
    beforeData: { id: sale.id, status: sale.status },
    requestedData: { id: sale.id, status: requestedStatus },
  });
}

export async function executeApprovedSaleChange(input: {
  requestId: string;
  executorId: string;
}) {
  if (!(await canApproveAuthorization(input.executorId))) {
    throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
  }

  const authorization = await prisma.authorizationRequest.findUnique({ where: { id: input.requestId } });
  if (!authorization) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (authorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
  if (authorization.type !== "SALE_CANCEL" && authorization.type !== "SALE_REFUND") throw new Error("AUTHORIZATION_TYPE_INVALID");
  if (authorization.entityType !== "Sale" || !authorization.entityId) throw new Error("AUTHORIZATION_ENTITY_INVALID");

  const expectedStatus = TARGET_STATUS[authorization.type];
  assertSaleAuthorizationIntegrity(authorization);
  assertSaleAuthorizationPayload(authorization, expectedStatus);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AuthorizationRequest" WHERE "id" = ${authorization.id} FOR UPDATE`;

    const currentAuthorization = await tx.authorizationRequest.findUnique({ where: { id: authorization.id } });
    if (!currentAuthorization) throw new Error("AUTHORIZATION_NOT_FOUND");
    if (currentAuthorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
    if (currentAuthorization.organizationId !== authorization.organizationId || currentAuthorization.branchId !== authorization.branchId || currentAuthorization.entityType !== "Sale" || currentAuthorization.entityId !== authorization.entityId) {
      throw new Error("AUTHORIZATION_ENTITY_INVALID");
    }
    if (currentAuthorization.type !== authorization.type || currentAuthorization.reason !== authorization.reason || currentAuthorization.requestedById !== authorization.requestedById) {
      throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
    }

    const currentExecutor = await tx.user.findUnique({
      where: { id: input.executorId },
      include: { roles: { include: { role: true } }, branchAccess: true },
    });
    assertSaleAuthorizationExecutorScope(currentExecutor, currentAuthorization);

    assertSaleAuthorizationIntegrity(currentAuthorization);
    if (authorization.integrityHash && currentAuthorization.integrityHash !== authorization.integrityHash) {
      throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
    }
    assertSaleAuthorizationPayload(currentAuthorization, expectedStatus);

    const sale = await tx.sale.findUnique({
      where: { id: authorization.entityId! },
      include: { items: true },
    });
    if (!sale) throw new Error("SALE_NOT_FOUND");
    if (sale.branchId !== currentAuthorization.branchId) throw new Error("AUTHORIZATION_BRANCH_INVALID");

    const before = currentAuthorization.beforeData as SaleAuthorizationPayload | null;
    if (before?.id !== sale.id || before.status !== sale.status) {
      throw new Error("AUTHORIZATION_TARGET_INVALID");
    }
    if (sale.status !== "COMPLETED") throw new Error("SALE_ALREADY_CHANGED");

    const status = targetStatusFor(currentAuthorization.type);

    const changed = await tx.sale.updateMany({
      where: { id: sale.id, status: "COMPLETED" },
      data: { status },
    });
    if (changed.count !== 1) throw new Error("SALE_ALREADY_CHANGED");

    for (const item of sale.items) {
      await tx.inventoryBalance.upsert({
        where: { branchId_productId: { branchId: sale.branchId, productId: item.productId } },
        create: { branchId: sale.branchId, productId: item.productId, quantity: item.quantity },
        update: { quantity: { increment: item.quantity } },
      });

      await tx.inventoryMovement.create({
        data: {
          branchId: sale.branchId,
          productId: item.productId,
          type: "ADJUSTMENT",
          quantity: item.quantity,
          unitCost: item.costSnapshot,
          referenceType: status === "CANCELLED" ? "SALE_CANCEL" : "SALE_REFUND",
          referenceId: sale.id,
          userId: input.executorId,
          occurredAt: new Date(),
          notes: `Reversión de inventario por ${status === "CANCELLED" ? "cancelación" : "devolución"} autorizada. Solicitud ${currentAuthorization.id}.`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: currentAuthorization.organizationId,
        branchId: currentAuthorization.branchId,
        userId: input.executorId,
        action: `SALE_${status}`,
        entityType: "Sale",
        entityId: sale.id,
        beforeData: {
          id: sale.id,
          status: sale.status,
          items: sale.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        },
        afterData: {
          id: sale.id,
          status,
          authorizationRequestId: currentAuthorization.id,
          inventoryRestored: true,
        },
      },
    });

    return { ...sale, status };
  });
}

function assertSaleAuthorizationExecutorScope(
  executor: { id: string; organizationId: string; status: string; roles: Array<{ role: { name: string } }>; branchAccess: Array<{ branchId: string }> } | null,
  authorization: { organizationId: string; branchId: string | null },
) {
  if (!executor || executor.status === "INACTIVE") throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
  if (!executor.roles.some(({ role }) => ["ENCARGADO_TIENDA", "GERENTE", "ADMIN", "SUPER_ADMIN"].includes(role.name))) {
    throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
  }
  if (executor.organizationId !== authorization.organizationId) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
  if (authorization.branchId && !executor.branchAccess.some(({ branchId }) => branchId === authorization.branchId)) {
    throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
  }
}

function assertSaleAuthorizationPayload(authorization: {
  entityId: string | null;
  beforeData: unknown;
  requestedData: unknown;
}, expectedStatus: string) {
  const before = authorization.beforeData as SaleAuthorizationPayload | null;
  const requested = authorization.requestedData as SaleAuthorizationPayload | null;
  if (before?.id !== authorization.entityId || before.status !== "COMPLETED") {
    throw new Error("AUTHORIZATION_TARGET_INVALID");
  }
  if (requested?.id !== authorization.entityId || requested.status !== expectedStatus) {
    throw new Error("AUTHORIZATION_TARGET_INVALID");
  }
}

function assertSaleAuthorizationIntegrity(authorization: {
  organizationId: string;
  branchId: string | null;
  requestedById: string;
  type: string;
  reason: string;
  entityType: string;
  entityId: string | null;
  beforeData: unknown;
  requestedData: unknown;
  integrityHash: string | null;
}) {
  if (!authorization.integrityHash) return;
  const expected = authorizationIntegrityHash({
    organizationId: authorization.organizationId,
    branchId: authorization.branchId ?? undefined,
    requestedById: authorization.requestedById,
    type: authorization.type,
    reason: authorization.reason,
    entityType: authorization.entityType,
    entityId: authorization.entityId ?? undefined,
    beforeData: authorization.beforeData,
    requestedData: authorization.requestedData,
  });
  if (authorization.integrityHash !== expected) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
}

function targetStatusFor(type: string) {
  if (type !== "SALE_CANCEL" && type !== "SALE_REFUND") {
    throw new Error("AUTHORIZATION_TYPE_INVALID");
  }
  return TARGET_STATUS[type];
}

async function getSaleOrganizationId(branchId: string) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { organizationId: true },
  });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  return branch.organizationId;
}
