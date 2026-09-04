import { prisma } from "../lib/prisma";
import { canApproveAuthorization, requestAuthorization } from "./authorization";

export type InventoryAdjustmentType =
  | "ENTRY"
  | "EXIT"
  | "COUNT_CORRECTION"
  | "WASTE"
  | "SHRINKAGE";

const MOVEMENT_TYPE = {
  ENTRY: "ADJUSTMENT",
  EXIT: "ADJUSTMENT",
  COUNT_CORRECTION: "ADJUSTMENT",
  WASTE: "WASTE",
  SHRINKAGE: "SHRINKAGE",
} as const;

function deltaFor(type: InventoryAdjustmentType, quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("INVENTORY_QUANTITY_INVALID");
  }
  return type === "ENTRY" ? quantity : -quantity;
}

export async function requestInventoryAdjustment(input: {
  branchId: string;
  productId: string;
  requestedById: string;
  employeeId: string;
  type: InventoryAdjustmentType;
  quantity: number;
  reason: string;
  unitCost?: number;
}) {
  if (!input.reason.trim()) throw new Error("AUTHORIZATION_REASON_REQUIRED");

  const delta = deltaFor(input.type, input.quantity);
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
  const resultingQuantity = currentQuantity + delta;
  if (resultingQuantity < 0) throw new Error("INVENTORY_NEGATIVE_NOT_ALLOWED");

  return requestAuthorization({
    organizationId: branch.organizationId,
    branchId: input.branchId,
    requestedById: input.requestedById,
    type: "INVENTORY_ADJUSTMENT",
    reason: input.reason.trim(),
    entityType: "InventoryBalance",
    entityId: input.productId,
    beforeData: {
      branchId: input.branchId,
      productId: input.productId,
      quantity: currentQuantity,
    },
    requestedData: {
      branchId: input.branchId,
      productId: input.productId,
      employeeId: input.employeeId,
      adjustmentType: input.type,
      quantity: input.quantity,
      delta,
      resultingQuantity,
      unitCost: input.unitCost ?? null,
    },
  });
}

export async function executeApprovedInventoryAdjustment(input: {
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
  if (authorization.entityType !== "InventoryBalance" || !authorization.entityId) {
    throw new Error("AUTHORIZATION_ENTITY_INVALID");
  }

  const requested = authorization.requestedData as {
    branchId?: string;
    productId?: string;
    employeeId?: string;
    adjustmentType?: InventoryAdjustmentType;
    quantity?: number;
    delta?: number;
    resultingQuantity?: number;
    unitCost?: number | null;
  } | null;

  if (
    requested?.branchId !== authorization.branchId ||
    requested.productId !== authorization.entityId ||
    !requested.employeeId ||
    !requested.adjustmentType ||
    typeof requested.quantity !== "number" ||
    typeof requested.delta !== "number"
  ) {
    throw new Error("AUTHORIZATION_TARGET_INVALID");
  }

  const expectedDelta = deltaFor(requested.adjustmentType, requested.quantity);
  if (expectedDelta !== requested.delta) throw new Error("AUTHORIZATION_TARGET_INVALID");

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id: requested.employeeId },
      select: { organizationId: true },
    });
    if (!employee || employee.organizationId !== authorization.organizationId) {
      throw new Error("EMPLOYEE_BRANCH_INVALID");
    }

    const current = await tx.inventoryBalance.findUnique({
      where: {
        branchId_productId: {
          branchId: authorization.branchId!,
          productId: authorization.entityId!,
        },
      },
    });
    const currentQuantity = Number(current?.quantity ?? 0);
    const newQuantity = currentQuantity + requested.delta;
    if (newQuantity < 0) throw new Error("INVENTORY_NEGATIVE_NOT_ALLOWED");

    if (requested.resultingQuantity !== undefined && Number(requested.resultingQuantity) !== newQuantity) {
      throw new Error("INVENTORY_CHANGED_SINCE_REQUEST");
    }

    await tx.inventoryBalance.upsert({
      where: {
        branchId_productId: {
          branchId: authorization.branchId!,
          productId: authorization.entityId!,
        },
      },
      create: {
        branchId: authorization.branchId!,
        productId: authorization.entityId!,
        quantity: newQuantity,
      },
      update: { quantity: newQuantity },
    });

    await tx.inventoryMovement.create({
      data: {
        branchId: authorization.branchId!,
        productId: authorization.entityId!,
        type: MOVEMENT_TYPE[requested.adjustmentType],
        quantity: requested.delta,
        unitCost: requested.unitCost ?? null,
        referenceType: `MANUAL_${requested.adjustmentType}`,
        referenceId: authorization.id,
        userId: input.executorId,
        employeeId: requested.employeeId,
        occurredAt: new Date(),
        notes: `${requested.adjustmentType}: ${authorization.reason}`,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: authorization.organizationId,
        branchId: authorization.branchId,
        userId: input.executorId,
        action: `INVENTORY_${requested.adjustmentType}`,
        entityType: "InventoryBalance",
        entityId: authorization.entityId,
        beforeData: {
          quantity: currentQuantity,
          productId: authorization.entityId,
        },
        afterData: {
          quantity: newQuantity,
          delta: requested.delta,
          employeeId: requested.employeeId,
          authorizationRequestId: authorization.id,
        },
      },
    });

    return {
      branchId: authorization.branchId,
      productId: authorization.entityId,
      previousQuantity: currentQuantity,
      newQuantity,
      delta: requested.delta,
      adjustmentType: requested.adjustmentType,
    };
  });
}
