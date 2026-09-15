import { authorizationIntegrityHash, canApproveAuthorization, requestAuthorization } from "./authorization";
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

  const [branch, product, employee, balance, branchProduct] = await Promise.all([
    prisma.branch.findUnique({ where: { id: input.branchId }, select: { organizationId: true } }),
    prisma.product.findUnique({ where: { id: input.productId }, select: { organizationId: true } }),
    prisma.employee.findUnique({ where: { id: input.employeeId }, select: { organizationId: true } }),
    prisma.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { quantity: true },
    }),
    prisma.branchProduct.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { isEnabled: true, product: { select: { organizationId: true } } },
    }),
  ]);

  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  if (product.organizationId !== branch.organizationId) throw new Error("PRODUCT_BRANCH_INVALID");
  if (!branchProduct || !branchProduct.isEnabled || branchProduct.product.organizationId !== branch.organizationId) {
    throw new Error("BRANCH_PRODUCT_SCOPE_FORBIDDEN");
  }
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
  if (authorization.entityType !== "InventoryBalance" || !authorization.entityId || !authorization.branchId) throw new Error("AUTHORIZATION_ENTITY_INVALID");

  const executor = await prisma.user.findUnique({
    where: { id: input.executorId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      branchAccess: { where: { branchId: authorization.branchId }, select: { branchId: true } },
    },
  });
  if (!executor || executor.status !== "ACTIVE" || executor.organizationId !== authorization.organizationId || !executor.branchAccess.length) {
    throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
  }

  const requested = authorization.requestedData as {
    branchId?: string; productId?: string; employeeId?: string; adjustmentType?: string;
    quantity?: number; delta?: number; resultingQuantity?: number; countedQuantity?: number;
  } | null;
  if (!requested || requested.branchId !== authorization.branchId || requested.productId !== authorization.entityId ||
      !requested.employeeId || requested.adjustmentType !== "COUNT_CORRECTION" || typeof requested.quantity !== "number" ||
      typeof requested.delta !== "number" || typeof requested.resultingQuantity !== "number" || typeof requested.countedQuantity !== "number") {
    throw new Error("AUTHORIZATION_TARGET_INVALID");
  }
  if (!Number.isFinite(requested.quantity) || requested.quantity < 0 || !Number.isFinite(requested.delta) ||
      !Number.isFinite(requested.resultingQuantity) || requested.resultingQuantity < 0 ||
      requested.resultingQuantity !== requested.countedQuantity || Math.abs(requested.quantity - Math.abs(requested.delta)) > 0.0000001) {
    throw new Error("AUTHORIZATION_TARGET_INVALID");
  }

  const expectedIntegrityHash = authorizationIntegrityHash({
    organizationId: authorization.organizationId,
    branchId: authorization.branchId,
    requestedById: authorization.requestedById,
    type: authorization.type,
    reason: authorization.reason,
    entityType: authorization.entityType,
    entityId: authorization.entityId,
    beforeData: authorization.beforeData,
    requestedData: authorization.requestedData,
  });
  if (authorization.integrityHash && authorization.integrityHash !== expectedIntegrityHash) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AuthorizationRequest" WHERE "id" = ${authorization.id} FOR UPDATE`;
    const currentAuthorization = await tx.authorizationRequest.findUnique({ where: { id: authorization.id } });
    if (!currentAuthorization) throw new Error("AUTHORIZATION_NOT_FOUND");
    if (currentAuthorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
    if (currentAuthorization.entityType !== "InventoryBalance" || currentAuthorization.entityId !== authorization.entityId || currentAuthorization.organizationId !== authorization.organizationId || currentAuthorization.branchId !== authorization.branchId) {
      throw new Error("AUTHORIZATION_TARGET_INVALID");
    }

    const currentHash = authorizationIntegrityHash({
      organizationId: currentAuthorization.organizationId,
      branchId: currentAuthorization.branchId ?? undefined,
      requestedById: currentAuthorization.requestedById,
      type: currentAuthorization.type,
      reason: currentAuthorization.reason,
      entityType: currentAuthorization.entityType,
      entityId: currentAuthorization.entityId ?? undefined,
      beforeData: currentAuthorization.beforeData,
      requestedData: currentAuthorization.requestedData,
    });
    if (currentAuthorization.integrityHash && currentAuthorization.integrityHash !== currentHash) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
    if (authorization.integrityHash && currentAuthorization.integrityHash !== authorization.integrityHash) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");

    const currentRequested = currentAuthorization.requestedData as typeof requested;
    if (!currentRequested || JSON.stringify(currentRequested) !== JSON.stringify(requested)) throw new Error("AUTHORIZATION_TARGET_INVALID");

    const currentExecutor = await tx.user.findUnique({
      where: { id: input.executorId },
      select: { id: true, organizationId: true, status: true, branchAccess: { where: { branchId: currentAuthorization.branchId ?? "" }, select: { branchId: true } } },
    });
    if (!currentExecutor || currentExecutor.status !== "ACTIVE" || currentExecutor.organizationId !== currentAuthorization.organizationId || !currentExecutor.branchAccess.length) {
      throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
    }

    const approval = await tx.authorizationApproval.findFirst({
      where: { authorizationRequestId: currentAuthorization.id, decision: "APPROVED" },
      orderBy: { approvedAt: "desc" },
    });
    if (!approval || approval.approverId !== input.executorId) throw new Error("AUTHORIZATION_APPROVAL_INVALID");
    if (!(approval.approvedAt instanceof Date) || Number.isNaN(approval.approvedAt.getTime())) throw new Error("AUTHORIZATION_APPROVAL_INVALID");
    if (currentAuthorization.resolvedAt && approval.approvedAt.getTime() > currentAuthorization.resolvedAt.getTime()) throw new Error("AUTHORIZATION_APPROVAL_INVALID");

    const branchProduct = await tx.branchProduct.findUnique({
      where: { branchId_productId: { branchId: currentAuthorization.branchId!, productId: currentAuthorization.entityId! } },
      select: { isEnabled: true, product: { select: { organizationId: true } } },
    });
    if (!branchProduct || !branchProduct.isEnabled || branchProduct.product.organizationId !== currentAuthorization.organizationId) {
      throw new Error("BRANCH_PRODUCT_SCOPE_FORBIDDEN");
    }

    const alreadyExecuted = await tx.inventoryMovement.findFirst({
      where: { referenceType: "PHYSICAL_COUNT", referenceId: currentAuthorization.id },
      select: { id: true },
    });
    if (alreadyExecuted) throw new Error("AUTHORIZATION_ALREADY_EXECUTED");

    const employee = await tx.employee.findUnique({ where: { id: currentRequested.employeeId }, select: { organizationId: true } });
    if (!employee || employee.organizationId !== currentAuthorization.organizationId) throw new Error("EMPLOYEE_BRANCH_INVALID");

    const current = await tx.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: currentAuthorization.branchId!, productId: currentAuthorization.entityId! } },
    });
    const currentQuantity = Number(current?.quantity ?? 0);
    const expectedQuantity = Number(currentRequested.resultingQuantity);
    const expectedDelta = expectedQuantity - currentQuantity;
    if (Math.abs(expectedDelta - Number(currentRequested.delta)) > 0.0000001) throw new Error("INVENTORY_CHANGED_SINCE_REQUEST");

    const executionAt = new Date();
    await tx.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: currentAuthorization.branchId!, productId: currentAuthorization.entityId! } },
      create: { branchId: currentAuthorization.branchId!, productId: currentAuthorization.entityId!, quantity: expectedQuantity },
      update: { quantity: expectedQuantity },
    });

    let movement;
    try {
      movement = await tx.inventoryMovement.create({
        data: {
          branchId: currentAuthorization.branchId!,
          productId: currentAuthorization.entityId!,
          type: "ADJUSTMENT",
          quantity: expectedDelta,
          referenceType: "PHYSICAL_COUNT",
          referenceId: currentAuthorization.id,
          userId: input.executorId,
          employeeId: currentRequested.employeeId,
          occurredAt: executionAt,
          notes: `COUNT_CORRECTION: ${currentAuthorization.reason} | authorizationRequestId=${currentAuthorization.id} | authorizationApprovalId=${approval.id} | executionAt=${executionAt.toISOString()}`,
        },
      });
    } catch (error: any) {
      if (error?.code === "P2002") throw new Error("AUTHORIZATION_ALREADY_EXECUTED");
      throw error;
    }
    if (!movement?.id) throw new Error("AUTHORIZATION_TRACE_BROKEN");

    const audit = await tx.auditLog.create({
      data: {
        organizationId: currentAuthorization.organizationId,
        branchId: currentAuthorization.branchId,
        userId: input.executorId,
        action: "INVENTORY_PHYSICAL_COUNT",
        entityType: "InventoryBalance",
        entityId: currentAuthorization.entityId,
        beforeData: { quantity: currentQuantity, authorizationRequestId: currentAuthorization.id, authorizationApprovalId: approval.id },
        afterData: { quantity: expectedQuantity, delta: expectedDelta, employeeId: currentRequested.employeeId, authorizationRequestId: currentAuthorization.id, authorizationApprovalId: approval.id, inventoryMovementId: movement.id, executionAt: executionAt.toISOString() },
      },
    });
    if (!audit?.id) throw new Error("AUTHORIZATION_TRACE_BROKEN");

    return {
      branchId: currentAuthorization.branchId,
      productId: currentAuthorization.entityId,
      previousQuantity: currentQuantity,
      countedQuantity: expectedQuantity,
      delta: expectedDelta,
      authorizationRequestId: currentAuthorization.id,
      authorizationApprovalId: approval.id,
      inventoryMovementId: movement.id,
      auditLogId: audit.id,
      executionAt,
    };
  });
}