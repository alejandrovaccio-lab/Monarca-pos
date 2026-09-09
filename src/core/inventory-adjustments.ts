import { prisma } from "../lib/prisma";
import { authorizationIntegrityHash, canApproveAuthorization, requestAuthorization } from "./authorization";

export type InventoryAdjustmentType =
  | "ENTRY"
  | "EXIT"
  | "COUNT_CORRECTION"
  | "WASTE"
  | "SHRINKAGE";

const INVENTORY_ADJUSTMENT_TYPES = new Set<InventoryAdjustmentType>([
  "ENTRY", "EXIT", "COUNT_CORRECTION", "WASTE", "SHRINKAGE",
]);

const MOVEMENT_TYPE = {
  ENTRY: "ADJUSTMENT", EXIT: "ADJUSTMENT", COUNT_CORRECTION: "ADJUSTMENT", WASTE: "WASTE", SHRINKAGE: "SHRINKAGE",
} as const;

function deltaFor(type: InventoryAdjustmentType, quantity: number) {
  if (!INVENTORY_ADJUSTMENT_TYPES.has(type) || !Number.isFinite(quantity) || quantity <= 0) throw new Error("INVENTORY_QUANTITY_INVALID");
  return type === "ENTRY" ? quantity : -quantity;
}

type AuthorizedInventoryPayload = {
  branchId: string; productId: string; employeeId: string; adjustmentType: InventoryAdjustmentType;
  quantity: number; delta: number; resultingQuantity: number; unitCost: number | null;
};

function parseAuthorizedInventoryPayload(value: unknown): AuthorizedInventoryPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AUTHORIZATION_TARGET_INVALID");
  const payload = value as Record<string, unknown>;
  const allowedKeys = new Set(["branchId", "productId", "employeeId", "adjustmentType", "quantity", "delta", "resultingQuantity", "unitCost"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) throw new Error("AUTHORIZATION_TARGET_INVALID");
  if (
    typeof payload.branchId !== "string" || typeof payload.productId !== "string" || typeof payload.employeeId !== "string" ||
    typeof payload.adjustmentType !== "string" || typeof payload.quantity !== "number" || typeof payload.delta !== "number" ||
    typeof payload.resultingQuantity !== "number" || (payload.unitCost !== null && typeof payload.unitCost !== "number")
  ) throw new Error("AUTHORIZATION_TARGET_INVALID");
  const adjustmentType = payload.adjustmentType as InventoryAdjustmentType;
  if (deltaFor(adjustmentType, payload.quantity) !== payload.delta || !Number.isFinite(payload.resultingQuantity)) throw new Error("AUTHORIZATION_TARGET_INVALID");
  if (payload.unitCost !== null && (!Number.isFinite(payload.unitCost) || payload.unitCost < 0)) throw new Error("AUTHORIZATION_TARGET_INVALID");
  return {
    branchId: payload.branchId, productId: payload.productId, employeeId: payload.employeeId, adjustmentType,
    quantity: payload.quantity, delta: payload.delta, resultingQuantity: payload.resultingQuantity, unitCost: payload.unitCost,
  };
}

function sameAuthorizedInventoryPayload(a: unknown, b: unknown) {
  try { return JSON.stringify(parseAuthorizedInventoryPayload(a)) === JSON.stringify(parseAuthorizedInventoryPayload(b)); } catch { return false; }
}

export async function requestInventoryAdjustment(input: {
  branchId: string; productId: string; requestedById: string; employeeId: string; type: InventoryAdjustmentType;
  quantity: number; reason: string; unitCost?: number;
}) {
  if (!input.reason.trim()) throw new Error("AUTHORIZATION_REASON_REQUIRED");
  const delta = deltaFor(input.type, input.quantity);
  const [branch, product, employee, balance] = await Promise.all([
    prisma.branch.findUnique({ where: { id: input.branchId }, select: { organizationId: true } }),
    prisma.product.findUnique({ where: { id: input.productId }, select: { organizationId: true } }),
    prisma.employee.findUnique({ where: { id: input.employeeId }, select: { organizationId: true } }),
    prisma.inventoryBalance.findUnique({ where: { branchId_productId: { branchId: input.branchId, productId: input.productId } }, select: { quantity: true } }),
  ]);
  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  if (product.organizationId !== branch.organizationId) throw new Error("PRODUCT_BRANCH_INVALID");
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
  if (employee.organizationId !== branch.organizationId) throw new Error("EMPLOYEE_BRANCH_INVALID");
  if (input.unitCost !== undefined && (!Number.isFinite(input.unitCost) || input.unitCost < 0)) throw new Error("INVENTORY_UNIT_COST_INVALID");
  const currentQuantity = Number(balance?.quantity ?? 0);
  const resultingQuantity = currentQuantity + delta;
  if (resultingQuantity < 0) throw new Error("INVENTORY_NEGATIVE_NOT_ALLOWED");
  return requestAuthorization({
    organizationId: branch.organizationId, branchId: input.branchId, requestedById: input.requestedById,
    type: "INVENTORY_ADJUSTMENT", reason: input.reason.trim(), entityType: "InventoryBalance", entityId: input.productId,
    beforeData: { branchId: input.branchId, productId: input.productId, quantity: currentQuantity },
    requestedData: { branchId: input.branchId, productId: input.productId, employeeId: input.employeeId, adjustmentType: input.type, quantity: input.quantity, delta, resultingQuantity, unitCost: input.unitCost ?? null },
  });
}

export async function executeApprovedInventoryAdjustment(input: { requestId: string; executorId: string }) {
  if (!(await canApproveAuthorization(input.executorId))) throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
  const authorization = await prisma.authorizationRequest.findUnique({ where: { id: input.requestId } });
  if (!authorization) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (authorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
  if (authorization.entityType !== "InventoryBalance" || !authorization.entityId) throw new Error("AUTHORIZATION_ENTITY_INVALID");

  const executor = await prisma.user.findUnique({ where: { id: input.executorId }, select: { id: true, organizationId: true, status: true, branchAccess: { where: { branchId: authorization.branchId ?? "" }, select: { branchId: true } } } });
  if (!executor || executor.status !== "ACTIVE" || executor.organizationId !== authorization.organizationId) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
  if (authorization.branchId && !executor.branchAccess.length) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");

  const requested = parseAuthorizedInventoryPayload(authorization.requestedData);
  if (requested.branchId !== authorization.branchId || requested.productId !== authorization.entityId) throw new Error("AUTHORIZATION_TARGET_INVALID");

  const expectedIntegrityHash = authorizationIntegrityHash({
    organizationId: authorization.organizationId, branchId: authorization.branchId ?? undefined,
    requestedById: authorization.requestedById, type: authorization.type, reason: authorization.reason,
    entityType: authorization.entityType, entityId: authorization.entityId ?? undefined,
    beforeData: authorization.beforeData, requestedData: authorization.requestedData,
  });
  if (authorization.integrityHash && authorization.integrityHash !== expectedIntegrityHash) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AuthorizationRequest" WHERE "id" = ${authorization.id} FOR UPDATE`;
    const currentAuthorization = await tx.authorizationRequest.findUnique({ where: { id: authorization.id } });
    if (!currentAuthorization) throw new Error("AUTHORIZATION_NOT_FOUND");
    if (currentAuthorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
    if (currentAuthorization.entityType !== "InventoryBalance" || currentAuthorization.entityId !== authorization.entityId || currentAuthorization.organizationId !== authorization.organizationId || currentAuthorization.branchId !== authorization.branchId) throw new Error("AUTHORIZATION_TARGET_INVALID");

    const currentRequested = parseAuthorizedInventoryPayload(currentAuthorization.requestedData);
    if (currentRequested.branchId !== currentAuthorization.branchId || currentRequested.productId !== currentAuthorization.entityId) throw new Error("AUTHORIZATION_TARGET_INVALID");

    const currentHash = authorizationIntegrityHash({
      organizationId: currentAuthorization.organizationId, branchId: currentAuthorization.branchId ?? undefined,
      requestedById: currentAuthorization.requestedById, type: currentAuthorization.type, reason: currentAuthorization.reason,
      entityType: currentAuthorization.entityType, entityId: currentAuthorization.entityId ?? undefined,
      beforeData: currentAuthorization.beforeData, requestedData: currentAuthorization.requestedData,
    });
    if (currentAuthorization.integrityHash && currentAuthorization.integrityHash !== currentHash) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
    if (authorization.integrityHash && currentAuthorization.integrityHash !== authorization.integrityHash) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
    if (!sameAuthorizedInventoryPayload(currentAuthorization.requestedData, authorization.requestedData)) throw new Error("AUTHORIZATION_TARGET_INVALID");

    const currentExecutor = await tx.user.findUnique({ where: { id: input.executorId }, select: { id: true, organizationId: true, status: true, branchAccess: { where: { branchId: currentAuthorization.branchId ?? "" }, select: { branchId: true } } } });
    if (!currentExecutor || currentExecutor.status !== "ACTIVE" || currentExecutor.organizationId !== currentAuthorization.organizationId) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
    if (currentAuthorization.branchId && !currentExecutor.branchAccess.length) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
    const alreadyExecuted = await tx.inventoryMovement.findFirst({ where: { referenceType: `MANUAL_${currentRequested.adjustmentType}`, referenceId: authorization.id }, select: { id: true } });
    if (alreadyExecuted) throw new Error("AUTHORIZATION_ALREADY_EXECUTED");
    const employee = await tx.employee.findUnique({ where: { id: currentRequested.employeeId }, select: { organizationId: true } });
    if (!employee || employee.organizationId !== currentAuthorization.organizationId) throw new Error("EMPLOYEE_BRANCH_INVALID");
    const current = await tx.inventoryBalance.findUnique({ where: { branchId_productId: { branchId: currentAuthorization.branchId!, productId: currentAuthorization.entityId! } } });
    const currentQuantity = Number(current?.quantity ?? 0);
    const newQuantity = currentQuantity + currentRequested.delta;
    if (newQuantity < 0) throw new Error("INVENTORY_NEGATIVE_NOT_ALLOWED");
    if (Number(currentRequested.resultingQuantity) !== newQuantity) throw new Error("INVENTORY_CHANGED_SINCE_REQUEST");
    await tx.inventoryBalance.upsert({ where: { branchId_productId: { branchId: currentAuthorization.branchId!, productId: currentAuthorization.entityId! } }, create: { branchId: currentAuthorization.branchId!, productId: currentAuthorization.entityId!, quantity: newQuantity }, update: { quantity: newQuantity } });
    await tx.inventoryMovement.create({ data: { branchId: currentAuthorization.branchId!, productId: currentAuthorization.entityId!, type: MOVEMENT_TYPE[currentRequested.adjustmentType], quantity: currentRequested.delta, unitCost: currentRequested.unitCost, referenceType: `MANUAL_${currentRequested.adjustmentType}`, referenceId: authorization.id, userId: input.executorId, employeeId: currentRequested.employeeId, occurredAt: new Date(), notes: `${currentRequested.adjustmentType}: ${currentAuthorization.reason}` } });
    await tx.auditLog.create({ data: { organizationId: currentAuthorization.organizationId, branchId: currentAuthorization.branchId, userId: input.executorId, action: `INVENTORY_${currentRequested.adjustmentType}`, entityType: "InventoryBalance", entityId: currentAuthorization.entityId, beforeData: { quantity: currentQuantity, productId: currentAuthorization.entityId }, afterData: { quantity: newQuantity, delta: currentRequested.delta, employeeId: currentRequested.employeeId, authorizationRequestId: authorization.id } } });
    return { branchId: currentAuthorization.branchId, productId: currentAuthorization.entityId, previousQuantity: currentQuantity, newQuantity, delta: currentRequested.delta, adjustmentType: currentRequested.adjustmentType };
  });
}
