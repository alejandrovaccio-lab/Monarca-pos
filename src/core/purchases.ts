import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { canApproveAuthorization, requestAuthorization } from "./authorization";

export type PurchaseRequestItem = { productId: string; quantity: number; unitCost: number; taxRate?: number };

type RequestedPurchaseData = {
  purchaseId: string;
  branchId: string;
  supplierId: string;
  folio: string;
  employeeId: string;
  purchasedAt: string;
  items: PurchaseRequestItem[];
};

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
    if (!item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("PURCHASE_ITEM_INVALID");
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) throw new Error("PURCHASE_UNIT_COST_INVALID");
    if (item.taxRate !== undefined && (!Number.isFinite(item.taxRate) || item.taxRate < 0)) throw new Error("PURCHASE_TAX_RATE_INVALID");
  }
}

function validPurchaseIdentifier(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PURCHASE_IDENTIFIER_LENGTH;
}

function validPurchaseItem(value: unknown): value is PurchaseRequestItem {
  if (!value || typeof value !== "object") return false;
  const item = value as { productId?: unknown; quantity?: unknown; unitCost?: unknown; taxRate?: unknown };
  if (typeof item.productId !== "string" || item.productId.trim().length === 0 || item.productId.length > MAX_PURCHASE_PRODUCT_ID_LENGTH) return false;
  if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > MAX_PURCHASE_QUANTITY) return false;
  if (typeof item.unitCost !== "number" || !Number.isFinite(item.unitCost) || item.unitCost < 0 || item.unitCost > MAX_PURCHASE_UNIT_COST) return false;
  if (item.taxRate !== undefined && (typeof item.taxRate !== "number" || !Number.isFinite(item.taxRate) || item.taxRate < 0 || item.taxRate > MAX_PURCHASE_TAX_RATE)) return false;
  return true;
}

function validPurchasedAt(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PURCHASED_AT_LENGTH && !Number.isNaN(new Date(value).getTime());
}

function validRequestedPurchaseData(value: unknown): value is RequestedPurchaseData {
  if (!value || typeof value !== "object") return false;
  const requested = value as { purchaseId?: unknown; branchId?: unknown; supplierId?: unknown; folio?: unknown; employeeId?: unknown; purchasedAt?: unknown; items?: unknown };
  if (!validPurchaseIdentifier(requested.purchaseId)) return false;
  if (!validPurchaseIdentifier(requested.branchId)) return false;
  if (!validPurchaseIdentifier(requested.supplierId)) return false;
  if (!validPurchaseIdentifier(requested.employeeId)) return false;
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
  const purchasedAt = new Date(requested.purchasedAt);
  const folio = requested.folio.trim();
  if (Number.isNaN(purchasedAt.getTime())) throw new Error("PURCHASE_DATE_INVALID");
  if (!folio) throw new Error("PURCHASE_FOLIO_REQUIRED");

  return prisma.$transaction(async (tx) => {
    const executor = await tx.user.findUnique({ where: { id: input.executorId }, select: { organizationId: true, status: true, branchAccess: { select: { branchId: true } } } });
    if (!executor || executor.status === "INACTIVE") throw new Error("AUTHORIZATION_APPROVER_REQUIRED");
    if (executor.organizationId !== authorization.organizationId) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");
    if (authorization.branchId && !executor.branchAccess.some(({ branchId }) => branchId === authorization.branchId)) throw new Error("AUTHORIZATION_SCOPE_FORBIDDEN");

    const existing = await tx.purchase.findUnique({ where: { id: requested.purchaseId } });
    if (existing) throw new Error("PURCHASE_ALREADY_EXECUTED");
    const [branch, supplier, employee] = await Promise.all([
      tx.branch.findUnique({ where: { id: authorization.branchId! }, select: { organizationId: true } }),
      tx.supplier.findUnique({ where: { id: requested.supplierId }, select: { organizationId: true } }),
      tx.employee.findUnique({ where: { id: requested.employeeId }, select: { organizationId: true } }),
    ]);
    if (!branch || branch.organizationId !== authorization.organizationId) throw new Error("BRANCH_NOT_FOUND");
    if (!supplier || supplier.organizationId !== authorization.organizationId) throw new Error("SUPPLIER_BRANCH_INVALID");
    if (!employee || employee.organizationId !== authorization.organizationId) throw new Error("EMPLOYEE_BRANCH_INVALID");
    const productIds = [...new Set(requested.items.map((item) => item.productId))];
    const products = await tx.product.findMany({ where: { id: { in: productIds }, organizationId: authorization.organizationId }, select: { id: true } });
    if (products.length !== productIds.length) throw new Error("PURCHASE_PRODUCT_INVALID");

    const purchase = await tx.purchase.create({ data: { id: requested.purchaseId, branchId: authorization.branchId!, supplierId: requested.supplierId, folio, purchasedAt, items: { create: requested.items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitCost: item.unitCost, taxRate: item.taxRate ?? null })) } } });
    for (const item of requested.items) {
      const current = await tx.inventoryBalance.findUnique({ where: { branchId_productId: { branchId: authorization.branchId!, productId: item.productId } }, select: { quantity: true } });
      const previousQuantity = Number(current?.quantity ?? 0);
      const newQuantity = previousQuantity + item.quantity;
      await tx.inventoryBalance.upsert({ where: { branchId_productId: { branchId: authorization.branchId!, productId: item.productId } }, create: { branchId: authorization.branchId!, productId: item.productId, quantity: newQuantity }, update: { quantity: newQuantity } });
      await tx.inventoryMovement.create({ data: { branchId: authorization.branchId!, productId: item.productId, type: "PURCHASE", quantity: item.quantity, unitCost: item.unitCost, referenceType: "PURCHASE", referenceId: purchase.id, userId: input.executorId, employeeId: requested.employeeId, occurredAt: purchasedAt, notes: `Compra ${folio}: ${authorization.reason}` } });
      await tx.productCost.create({ data: { productId: item.productId, cost: item.unitCost, source: `PURCHASE:${purchase.id}`, effectiveAt: purchasedAt } });
    }
    await tx.auditLog.create({ data: { organizationId: authorization.organizationId, branchId: authorization.branchId, userId: input.executorId, action: "PURCHASE_RECEIVED", entityType: "Purchase", entityId: purchase.id, beforeData: { inventoryChanged: false }, afterData: { purchaseId: purchase.id, supplierId: requested.supplierId, folio, employeeId: requested.employeeId, items: requested.items, authorizationRequestId: authorization.id } } });
    return purchase;
  });
}
