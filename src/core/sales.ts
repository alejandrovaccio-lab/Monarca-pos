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
  const approver = await canApproveAuthorization(input.executorId);
  if (!approver) throw new Error("AUTHORIZATION_APPROVER_REQUIRED");

  const authorization = await prisma.authorizationRequest.findUnique({ where: { id: input.requestId } });
  if (!authorization) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (authorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
  if (authorization.entityType !== "Sale" || !authorization.entityId) throw new Error("AUTHORIZATION_ENTITY_INVALID");

  const requested = authorization.requestedData as { status?: string } | null;
  const targetStatus = requested?.status;
  if (targetStatus !== "CANCELLED" && targetStatus !== "REFUNDED") throw new Error("AUTHORIZATION_TARGET_INVALID");

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: authorization.entityId! } });
    if (!sale) throw new Error("SALE_NOT_FOUND");
    if (sale.status !== "COMPLETED") throw new Error("SALE_ALREADY_CHANGED");

    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: { status: targetStatus as "CANCELLED" | "REFUNDED" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: authorization.organizationId,
        branchId: authorization.branchId,
        userId: input.executorId,
        action: `SALE_${targetStatus}`,
        entityType: "Sale",
        entityId: sale.id,
        beforeData: { id: sale.id, status: sale.status },
        afterData: { id: sale.id, status: updated.status, authorizationRequestId: authorization.id },
      },
    });

    return updated;
  });
}

async function getSaleOrganizationId(branchId: string) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { organizationId: true } });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  return branch.organizationId;
}
