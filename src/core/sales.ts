import { prisma } from "../lib/prisma";
import { canApproveAuthorization, requestAuthorization } from "./authorization";

export type SaleChangeType = "SALE_CANCEL" | "SALE_REFUND";

const TARGET_STATUS = {
  SALE_CANCEL: "CANCELLED",
  SALE_REFUND: "REFUNDED",
} as const;

export async function requestSaleChange(input: {
  saleId: string;
  requestedById: string;
  type: SaleChangeType;
  reason: string;
}) {
  if (!input.reason.trim()) throw new Error("AUTHORIZATION_REASON_REQUIRED");

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

  const authorization = await prisma.authorizationRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!authorization) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (authorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
  if (authorization.entityType !== "Sale" || !authorization.entityId) {
    throw new Error("AUTHORIZATION_ENTITY_INVALID");
  }

  const requested = authorization.requestedData as { status?: string } | null;
  const targetStatus = requested?.status;
  if (targetStatus !== "CANCELLED" && targetStatus !== "REFUNDED") {
    throw new Error("AUTHORIZATION_TARGET_INVALID");
  }

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: authorization.entityId! },
      include: { items: true },
    });
    if (!sale) throw new Error("SALE_NOT_FOUND");
    if (sale.branchId !== authorization.branchId) throw new Error("AUTHORIZATION_BRANCH_INVALID");
    if (sale.status !== "COMPLETED") throw new Error("SALE_ALREADY_CHANGED");

    const status = targetStatus as "CANCELLED" | "REFUNDED";

    // Conditional update makes execution single-use even under concurrent requests.
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
          notes: `Reversión de inventario por ${status === "CANCELLED" ? "cancelación" : "devolución"} autorizada. Solicitud ${authorization.id}.`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: authorization.organizationId,
        branchId: authorization.branchId,
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
          authorizationRequestId: authorization.id,
          inventoryRestored: true,
        },
      },
    });

    return { ...sale, status };
  });
}

async function getSaleOrganizationId(branchId: string) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { organizationId: true },
  });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  return branch.organizationId;
}
