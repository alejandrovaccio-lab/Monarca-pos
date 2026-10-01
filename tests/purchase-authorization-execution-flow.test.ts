import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    authorizationRequest: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    authorizationApproval: { findFirst: vi.fn() },
    purchase: { findUnique: vi.fn(), create: vi.fn() },
    branch: { findUnique: vi.fn() },
    supplier: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    inventoryBalance: { findUnique: vi.fn(), upsert: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    productCost: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/core/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/authorization")>();
  return { ...actual, canApproveAuthorization: vi.fn(), authorizationIntegrityHash: vi.fn(() => "test-integrity-hash") };
});

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization } from "../src/core/authorization";
import { executeApprovedPurchaseReceipt } from "../src/core/purchases";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

function approvedAuthorization() {
  const requestedAt = new Date("2026-09-29T10:00:00.000Z");
  return {
    id: "auth-1",
    organizationId: "org-1",
    branchId: "branch-1",
    requestedById: "requester-1",
    status: "APPROVED",
    type: "OTHER",
    reason: "Resurtido autorizado",
    entityType: "Purchase",
    entityId: "purchase-1",
    beforeData: null,
    requestedAt,
    resolvedAt: new Date("2026-09-29T10:05:00.000Z"),
    integrityHash: "test-integrity-hash",
    requestedData: {
      purchaseId: "purchase-1",
      branchId: "branch-1",
      supplierId: "supplier-1",
      folio: "FAC-507",
      employeeId: "emp-1",
      purchasedAt: requestedAt.toISOString(),
      items: [{ productId: "product-1", quantity: 10, unitCost: 25, taxRate: 16 }],
    },
  };
}

function transaction() {
  const authorization = approvedAuthorization();
  return {
    authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
    user: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", organizationId: "org-1", branchAccess: [{ branchId: "branch-1" }], roles: [{ role: { name: "GERENTE" } }] }) },
    authorizationApproval: { findFirst: vi.fn().mockResolvedValue({ id: "approval-1", approverId: "manager-1", decision: "APPROVED", approvedAt: new Date("2026-09-29T10:04:00.000Z") }) },
    purchase: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "purchase-1", folio: "FAC-507" }) },
    branch: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    supplier: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    employee: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    product: { findMany: vi.fn().mockResolvedValue([{ id: "product-1" }]) },
    inventoryBalance: { findUnique: vi.fn().mockResolvedValue({ quantity: 5 }), upsert: vi.fn().mockResolvedValue({ quantity: 15 }) },
    inventoryMovement: { create: vi.fn().mockResolvedValue({ id: "movement-1" }) },
    productCost: { create: vi.fn().mockResolvedValue({ id: "cost-1" }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
  };
}

describe("approved purchase execution flow", () => {
  it("executes the complete approved purchase and records all inventory/accounting traces", async () => {
    canApproveAuthorization.mockResolvedValue(true);
    db.authorizationRequest.findUnique.mockResolvedValue(approvedAuthorization());
    const tx = transaction();
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(tx));

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "manager-1" }))
      .resolves.toMatchObject({ id: "purchase-1", folio: "FAC-507" });

    expect(tx.purchase.create).toHaveBeenCalledOnce();
    expect(tx.inventoryBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { quantity: 15 },
    }));
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "PURCHASE", quantity: 10, unitCost: 25, referenceType: "PURCHASE", referenceId: "purchase-1", userId: "manager-1", employeeId: "emp-1" }),
    }));
    expect(tx.productCost.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productId: "product-1", cost: 25, source: "PURCHASE:purchase-1" }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "PURCHASE_RECEIVED", entityType: "Purchase", entityId: "purchase-1", afterData: expect.objectContaining({ authorizationRequestId: "auth-1", approvalId: "approval-1", approverId: "manager-1" }) }),
    }));
  });

  it("retries the complete serializable purchase transaction after P2034", async () => {
    canApproveAuthorization.mockResolvedValue(true);
    db.authorizationRequest.findUnique.mockResolvedValue(approvedAuthorization());
    const tx = transaction();
    const serializationConflict = Object.assign(new Error("Transaction failed due to a write conflict or a deadlock. Please retry your transaction"), { code: "P2034" });
    db.$transaction
      .mockRejectedValueOnce(serializationConflict)
      .mockImplementationOnce(async (callback: (tx: any) => unknown) => callback(tx));

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "manager-1" }))
      .resolves.toMatchObject({ id: "purchase-1", folio: "FAC-507" });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.purchase.create).toHaveBeenCalledOnce();
    expect(tx.inventoryMovement.create).toHaveBeenCalledOnce();
    expect(tx.productCost.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it("refuses a second execution of the same approved purchase", async () => {
    canApproveAuthorization.mockResolvedValue(true);
    db.authorizationRequest.findUnique.mockResolvedValue(approvedAuthorization());
    const tx = transaction();
    tx.purchase.findUnique.mockResolvedValue({ id: "purchase-1" });
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(tx));

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "manager-1" }))
      .rejects.toThrow("PURCHASE_ALREADY_EXECUTED");
    expect(tx.purchase.create).not.toHaveBeenCalled();
    expect(tx.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });
});
