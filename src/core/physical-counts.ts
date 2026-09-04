import { canApproveAuthorization, requestAuthorization } from "./authorization";
import { prisma } from "../lib/prisma";

export async function requestPhysicalCount(input: {
  branchId: string;
  productId: string;
  requestedById: string;
  employeeId: string;
  countedQuantity: number;
  reason?: string;
}) {
  if (!Number.isFinite(input.countedQuantity) || input.countedQuantity < 0) {
    throw new Error("COUNT_QUANTITY_INVALID");
  }

  const [branch, product, employee, balance] = await Promise.all([
    prisma.branch.findUnique({ where: { id: input.branchId }, select: { organizationId: true } }),
    prisma.product.findUnique({ where: { id: input.productId }, select: { organizationId: true } }),
    prisma.employee.findUnique({ where: { id: input.employeeId }, select: { organizationId: true } }),
    prisma.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { quantity: true },
    }),
  ]);

  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  if (product.organizationId !== branch.organizationId) throw new Error("PRODUCT_BRANCH_INVALID");
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
  if (employee.organizationId !== branch.organizationId) throw new Error("EMPLOYEE_BRANCH_INVALID");

  const currentQuantity = Number(balance?.quantity ?? 0);
  const delta = input.countedQuantity - currentQuantity;

  return requestAuthorization({
    organizationId: branch.organizationId,
    branchId: input.branchId,
    requestedById: input.requestedById,
    type: "INVENTORY_ADJUSTMENT",
    reason: (input.reason?.trim() || "Conteo físico de inventario"),
    entityType: "InventoryBalance",
    entityId: input.productId,
    beforeData: { branchId: input.branchId, productId: input.productId, quantity: currentQuantity },
    requestedData: {
      branchId: input.branchId,
      productId: input.productId,
      employeeId: input.employeeId,
      adjustmentType: "COUNT_CORRECTION",
      quantity: Math.abs(delta),
      delta,
      resultingQuantity: input.countedQuantity,
      countedQuantity: input.countedQuantity,
    },
  });
}

export async function executeApprovedPhysicalCount(input: {
  requestId: string;
  executorId: string;
}) {
  if (!(await canApproveAuthorization(input.executorId))) throw new Error("AUTHORIZATION_APPROVER_REQUIRED");

  const authorization = await prisma.authorizationRequest.findUnique({ where: { id: input.requestId } });
  if (!authorization) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (authorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
  if (authorization.entityType !== "InventoryBalance" || !authorization.entityId) throw new Error("AUTHORIZATION_ENTITY_INVALID");

  const requested = authorization.requestedData as {
    branchId?: string; productId?: string; employeeId?: string; adjustmentType?: string;
    quantity?: number; delta?: number; resultingQuantity?: number; countedQuantity?: number;
  } | null;
  if (!requested || requested.branchId !== authorization.branchId || requested.productId !== authorization.entityId ||
      !requested.employeeId || requested.adjustmentType !== "COUNT_CORRECTION" || typeof requested.delta !== "number" ||
      typeof requested.resultingQuantity !== "number" || typeof requested.countedQuantity !== "number") {
    throw new Error("AUTHORIZATION_TARGET_INVALID");
  }
  if (requested.resultingQuantity !== requested.countedQuantity || requested.countedQuantity < 0) {
    throw new Error("AUTHORIZATION_TARGET_INVALID");
  }

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: requested.employeeId }, select: { organizationId: true } });
    if (!employee || employee.organizationId !== authorization.organizationId) throw new Error("EMPLOYEE_BRANCH_INVALID");

    const current = await tx.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: authorization.branchId!, productId: authorization.entityId! } },
    });
    const currentQuantity = Number(current?.quantity ?? 0);
    const expectedQuantity = Number(requested.resultingQuantity);
    const expectedDelta = expectedQuantity - currentQuantity;
    if (Math.abs(expectedDelta - Number(requested.delta)) > 0.0000001) throw new Error("INVENTORY_CHANGED_SINCE_REQUEST");

    await tx.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: authorization.branchId!, productId: authorization.entityId! } },
      create: { branchId: authorization.branchId!, productId: authorization.entityId!, quantity: expectedQuantity },
      update: { quantity: expectedQuantity },
    });

    await tx.inventoryMovement.create({
      data: {
        branchId: authorization.branchId!, productId: authorization.entityId!, type: "ADJUSTMENT",
        quantity: expectedDelta, referenceType: "PHYSICAL_COUNT", referenceId: authorization.id,
        userId: input.executorId, employeeId: requested.employeeId, occurredAt: new Date(),
        notes: `COUNT_CORRECTION: ${authorization.reason}`,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: authorization.organizationId, branchId: authorization.branchId, userId: input.executorId,
        action: "INVENTORY_PHYSICAL_COUNT", entityType: "InventoryBalance", entityId: authorization.entityId,
        beforeData: { quantity: currentQuantity },
        afterData: { quantity: expectedQuantity, delta: expectedDelta, employeeId: requested.employeeId, authorizationRequestId: authorization.id },
      },
    });

    return { branchId: authorization.branchId, productId: authorization.entityId, previousQuantity: currentQuantity, countedQuantity: expectedQuantity, delta: expectedDelta };
  });
}
