import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { APPROVER_ROLES, authorizationIntegrityHash, canApproveAuthorization, requestAuthorization } from "./authorization";

export type PurchaseRequestItem = { productId: string; quantity: number; unitCost: number; taxRate?: number };

type RequestedPurchaseData = { purchaseId: string; branchId: string; supplierId: string; folio: string; employeeId: string; purchasedAt: string; items: PurchaseRequestItem[] };

const MAX_PURCHASE_FOLIO_LENGTH = 128;
const MAX_PURCHASE_IDENTIFIER_LENGTH = 128;
const MAX_PURCHASE_PRODUCT_ID_LENGTH = 128;
const MAX_PURCHASE_ITEMS = 100;
const MAX_PURCHASE_QUANTITY = 1_000_000;
const MAX_PURCHASE_UNIT_COST = 1_000_000_000;
const MAX_PURCHASE_TAX_RATE = 100;
const MAX_PURCHASED_AT_LENGTH = 64;

function validateItems(items: PurchaseRequestItem[]) {
  if (!items.length) throw new Error("PURCHASE_ITEMS_REQUIRED");
  for (const item of items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("PURCHASE_ITEM_INVALID");
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) throw new Error("PURCHASE_UNIT_COST_INVALID");
    if (item.taxRate !== undefined && (!Number.isFinite(item.taxRate) || item.taxRate < 0)) throw new Error("PURCHASE_TAX_RATE_INVALID");
  }
}
function validPurchaseIdentifier(value: unknown) { return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PURCHASE_IDENTIFIER_LENGTH; }
function validPurchaseItem(value: unknown): value is PurchaseRequestItem {
  if (!value || typeof value !== "object") return false;
  const item = value as { productId?: unknown; quantity?: unknown; unitCost?: unknown; taxRate?: unknown };
  if (typeof item.productId !== "string" || item.productId.trim().length === 0 || item.productId.length > MAX_PURCHASE_PRODUCT_ID_LENGTH) return false;
  if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > MAX_PURCHASE_QUANTITY) return false;
  if (typeof item.unitCost !== "number" || !Number.isFinite(item.unitCost) || item.unitCost < 0 || item.unitCost > MAX_PURCHASE_UNIT_COST) return false;
  if (item.taxRate !== undefined && (typeof item.taxRate !== "number" || !Number.isFinite(item.taxRate) || item.taxRate < 0 || item.taxRate > MAX_PURCHASE_TAX_RATE)) return false;
  return true;
}
function validPurchasedAt(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PURCHASED_AT_LENGTH && !Number.isNaN(new Date(value).getTime()); }
function validRequestedPurchaseData(value: unknown): value is RequestedPurchaseData {
  if (!value || typeof value !== "object") return false;
  const requested = value as { purchaseId?: unknown; branchId?: unknown; supplierId?: unknown; folio?: unknown; employeeId?: unknown; purchasedAt?: unknown; items?: unknown };
  if (!validPurchaseIdentifier(requested.purchaseId) || !validPurchaseIdentifier(requested.branchId) || !validPurchaseIdentifier(requested.supplierId) || !validPurchaseIdentifier(requested.employeeId)) return false;
  if (typeof requested.folio !== "string" || requested.folio.trim().length === 0 || requested.folio.length > MAX_PURCHASE_FOLIO_LENGTH) return false;
  if (!validPurchasedAt(requested.purchasedAt)) return false;
  if (!Array.isArray(requested.items) || requested.items.length === 0 || requested.items.length > MAX_PURCHASE_ITEMS) return false;
  return requested.items.every(validPurchaseItem);
}

export async function requestPurchaseReceipt(input: { branchId: string; requestedById: string; employeeId: string; supplierId: string; folio: string; reason: string; purchasedAt?: string | Date; items: PurchaseRequestItem[] }) {
  if (!input.reason.trim()) throw new Error("AUTHORIZATION_REASON_REQUIRED");
  if (!input.folio.trim()) throw new Error("PURCHASE_FOLIO_REQUIRED");
  validateItems(input.items);
  const [branch, requester, employee, supplier] = await Promise.all([
    prisma.branch.findUnique({ where: { id: input.branchId }, select: { organizationId: true } }),
    prisma.user.findUnique({ where: { id: input.requestedById }, select: { organizationId: true } }),
    prisma.employee.findUnique({ where: { id: input.employeeId }, select: { organizationId: true } }),
    prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { organizationId: true } }),
  ]);
  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  if (!requester || requester.organizationId !== branch.organizationId) throw new Error("REQUESTER_BRANCH_INVALID");
  if (!employee || employee.organizationId !== branch.organizationId) throw new Error("EMPLOYEE_BRANCH_INVALID");
  if (!supplier || supplier.organizationId !== branch.organizationId) throw new Error("SUPPLIER_BRANCH_INVALID");
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, organizationId: branch.organizationId }, select: { id: true } });
  if (products.length !== productIds.length) throw new Error("PURCHASE_PRODUCT_INVALID");
  const purchaseId = randomUUID();
  const purchasedAt = input.purchasedAt ? new Date(input.purchasedAt) : new Date();
  if (Number.isNaN(purchasedAt.getTime())) throw new Error("PURCHASE_DATE_INVALID");
  return requestAuthorization({ organizationId: branch.organizationId, branchId: input.branchId, requestedById: input.requestedById, type: "OTHER", reason: input.reason.trim(), entityType: "Purchase", entityId: purchaseId, beforeData: null, requestedData: { purchaseId, branchId: input.branchId, supplierId: input.supplierId, folio: input.folio.trim(), employeeId: input.employeeId, purchasedAt: purchasedAt.toISOString(), items: input.items } });
}

export async function executeApprovedPurchaseReceipt(input: { requestId: string; executorId: string }) {
  if (!(await canApproveAuthorization(input.executorId))) throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
  const authorization = await prisma.authorizationRequest.findUnique({ where: { id: input.requestId } });
  if (!authorization) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (authorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
  if (authorization.entityType !== "Purchase" || !authorization.entityId) throw new Error("AUTHORIZATION_ENTITY_INVALID");
  const requested = authorization.requestedData as RequestedPurchaseData | null;
  if (!validRequestedPurchaseData(requested)) throw new Error("AUTHORIZATION_TARGET_INVALID");
  if (requested.purchaseId !== authorization.entityId || requested.branchId !== authorization.branchId) throw new Error("AUTHORIZATION_TARGET_INVALID");
  validateItems(requested.items);
  const expectedIntegrityHash = authorizationIntegrityHash({ organizationId: authorization.organizationId, branchId: authorization.branchId ?? undefined, requestedById: authorization.requestedById, type: authorization.type, reason: authorization.reason, entityType: authorization.entityType, entityId: authorization.entityId ?? undefined, beforeData: authorization.beforeData, requestedData: authorization.requestedData });
  if (!authorization.integrityHash || authorization.integrityHash !== expectedIntegrityHash) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");

  return prisma.$transaction(async (tx) => {
    const currentAuthorization = await tx.authorizationRequest.findUnique({ where: { id: authorization.id } });
    if (!currentAuthorization) throw new Error("AUTHORIZATION_NOT_FOUND");
    if (currentAuthorization.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
    if (currentAuthorization.organizationId !== authorization.organizationId || currentAuthorization.branchId !== authorization.branchId || currentAuthorization.requestedById !== authorization.requestedById || currentAuthorization.type !== authorization.type || currentAuthorization.reason !== authorization.reason || currentAuthorization.entityType !== authorization.entityType || currentAuthorization.entityId !== authorization.entityId) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
    const currentIntegrityHash = authorizationIntegrityHash({ organizationId: currentAuthorization.organizationId, branchId: currentAuthorization.branchId ?? undefined, requestedById: currentAuthorization.requestedById, type: currentAuthorization.type, reason: currentAuthorization.reason, entityType: currentAuthorization.entityType, entityId: currentAuthorization.entityId ?? undefined, beforeData: currentAuthorization.beforeData, requestedData: currentAuthorization.requestedData });
    if (!currentAuthorization.integrityHash || currentAuthorization.integrityHash !== currentIntegrityHash || currentAuthorization.integrityHash !== authorization.integrityHash) throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
    const currentRequested = currentAuthorization.requestedData as RequestedPurchaseData | null;
    if (!validRequestedPurchaseData(currentRequested)) throw new Error("AUTHORIZATION_TARGET_INVALID");

    const executor = await tx.user.findUnique({ where: { id: input.executorId }, select: { organizationId: true, status: true, branchAccess: { select: { branchId: true } }, roles: { select: { role: { select: { name: true } } } } } });
    if (!executor || executor.status === "INACTIVE") throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
    if (!executor.roles.some(({ role }) => APPROVER_ROLES.has(role.name))) throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
    if (executor.organizationId !== currentAuthorization.organizationId) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
    if (currentAuthorization.branchId && !executor.branchAccess.some(({ branchId }) => branchId === currentAuthorization.branchId)) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");

    const approval = await tx.authorizationApproval.findFirst({ where: { authorizationRequestId: currentAuthorization.id }, orderBy: { approvedAt: "desc" }, select: { id: true, approverId: true, decision: true } });
    if (!approval || approval.decision !== "APPROVED") throw new Error("AUTHORIZATION_INTEGRITY_VIOLATION");
    if (approval.approverId !== input.executorId) throw new Error("AUTHORIZATION_APPROVER_MISMATCH");

    const existing = await tx.purchase.findUnique({ where: { id: currentRequested.purchaseId } });
    if (existing) throw new Error("PURCHASE_ALREADY_EXECUTED");
    const currentPurchasedAt = new Date(currentRequested.purchasedAt);
    if (Number.isNaN(currentPurchasedAt.getTime())) throw new Error("PURCHASE_DATE_INVALID");
    const currentFolio = currentRequested.folio.trim();
    if (!currentFolio) throw new Error("PURCHASE_FOLIO_REQUIRED");
    const [branch, supplier, employee] = await Promise.all([
      tx.branch.findUnique({ where: { id: currentAuthorization.branchId! }, select: { organizationId: true } }),
      tx.supplier.findUnique({ where: { id: currentRequested.supplierId }, select: { organizationId: true } }),
      tx.employee.findUnique({ where: { id: currentRequested.employeeId }, select: { organizationId: true } }),
    ]);
    if (!branch || branch.organizationId !== currentAuthorization.organizationId) throw new Error("BRANCH_NOT_FOUND");
    if (!supplier || supplier.organizationId !== currentAuthorization.organizationId) throw new Error("SUPPLIER_BRANCH_INVALID");
    if (!employee || employee.organizationId !== currentAuthorization.organizationId) throw new Error("EMPLOYEE_BRANCH_INVALID");
    const productIds = [...new Set(currentRequested.items.map((item) => item.productId))];
    const products = await tx.product.findMany({ where: { id: { in: productIds }, organizationId: currentAuthorization.organizationId }, select: { id: true } });
    if (products.length !== productIds.length) throw new Error("PURCHASE_PRODUCT_INVALID");

    const purchase = await tx.purchase.create({ data: { id: currentRequested.purchaseId, branchId: currentAuthorization.branchId!, supplierId: currentRequested.supplierId, folio: currentFolio, purchasedAt: currentPurchasedAt, items: { create: currentRequested.items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitCost: item.unitCost, taxRate: item.taxRate ?? null })) } } });
    for (const item of currentRequested.items) {
      const current = await tx.inventoryBalance.findUnique({ where: { branchId_productId: { branchId: currentAuthorization.branchId!, productId: item.productId } }, select: { quantity: true } });
      const previousQuantity = Number(current?.quantity ?? 0);
      const newQuantity = previousQuantity + item.quantity;
      await tx.inventoryBalance.upsert({ where: { branchId_productId: { branchId: currentAuthorization.branchId!, productId: item.productId } }, create: { branchId: currentAuthorization.branchId!, productId: item.productId, quantity: newQuantity }, update: { quantity: newQuantity } });
      await tx.inventoryMovement.create({ data: { branchId: currentAuthorization.branchId!, productId: item.productId, type: "PURCHASE", quantity: item.quantity, unitCost: item.unitCost, referenceType: "PURCHASE", referenceId: purchase.id, userId: input.executorId, employeeId: currentRequested.employeeId, occurredAt: currentPurchasedAt, notes: `Compra ${currentFolio}: ${currentAuthorization.reason}` } });
      await tx.productCost.create({ data: { productId: item.productId, cost: item.unitCost, source: `PURCHASE:${purchase.id}`, effectiveAt: currentPurchasedAt } });
    }
    await tx.auditLog.create({ data: { organizationId: currentAuthorization.organizationId, branchId: currentAuthorization.branchId, userId: input.executorId, action: "PURCHASE_RECEIVED", entityType: "Purchase", entityId: purchase.id, beforeData: { inventoryChanged: false }, afterData: { purchaseId: purchase.id, supplierId: currentRequested.supplierId, folio: currentFolio, employeeId: currentRequested.employeeId, items: currentRequested.items, authorizationRequestId: currentAuthorization.id, approvalId: approval.id, approverId: approval.approverId } } });
    return purchase;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
