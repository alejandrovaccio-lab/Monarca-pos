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

const requestedAt = new Date("2026-09-29T10:00:00.000Z");
const approvedAt = new Date("2026-09-29T10:04:00.000Z");
const resolvedAt = new Date("2026-09-29T10:05:00.000Z");

function authorization(status: "APPROVED" | "REVOKED") {
  return {
    id: "auth-1",
    organizationId: "org-1",
    branchId: "branch-1",
    requestedById: "requester-1",
    status,
    type: "OTHER",
    reason: "Resurtido autorizado",
    entityType: "Purchase",
    entityId: "purchase-1",
    beforeData: null,
    requestedAt,
    resolvedAt,
    integrityHash: "test-integrity-hash",
    requestedData: {
      purchaseId: "purchase-1",
      branchId: "branch-1",
      supplierId: "supplier-1",
      folio: "FAC-518",
      employeeId: "emp-1",
      purchasedAt: requestedAt.toISOString(),
      items: [{ productId: "product-1", quantity: 10, unitCost: 25, taxRate: 16 }],
    },
  };
}

function transaction() {
  return {
    authorizationRequest: { findUnique: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", organizationId: "org-1", branchAccess: [{ branchId: "branch-1" }], roles: [{ role: { name: "GERENTE" } }] }) },
    authorizationApproval: { findFirst: vi.fn().mockResolvedValue({ id: "approval-1", approverId: "manager-1", decision: "APPROVED", approvedAt }) },
    purchase: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    branch: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    supplier: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    employee: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    product: { findMany: vi.fn().mockResolvedValue([{ id: "product-1" }]) },
    inventoryBalance: { findUnique: vi.fn().mockResolvedValue({ quantity: 5 }), upsert: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    productCost: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

beforeEach(() => vi.clearAllMocks());

function configureRetryAuthorizationRevocation(tx: ReturnType<typeof transaction>) {
  db.authorizationRequest.findUnique.mockResolvedValue(authorization("APPROVED"));
  tx.authorizationRequest.findUnique
    .mockResolvedValueOnce(authorization("APPROVED"))
    .mockResolvedValueOnce(authorization("REVOKED"));

  const serializationConflict = Object.assign(new Error("Transaction failed due to a write conflict or a deadlock. Please retry your transaction"), { code: "P2034" });

  // The first transaction observes the approved authorization, then encounters
  // the serialization conflict before any purchase side effect can occur.
  // The retry starts a fresh transaction and observes the revoked authorization.
  tx.user.findUnique.mockRejectedValueOnce(serializationConflict);

  db.$transaction.mockImplementation(async (callback: (transaction: any) => unknown) => callback(tx));
}

describe("purchase authorization revalidation across serializable retries", () => {
  it("rejects a purchase when authorization is revoked before the retry", async () => {
    canApproveAuthorization.mockResolvedValue(true);
    const tx = transaction();
    configureRetryAuthorizationRevocation(tx);

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_NOT_APPROVED");

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.authorizationRequest.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.purchase.create).not.toHaveBeenCalled();
    expect(tx.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    expect(tx.productCost.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not treat the pre-retry authorization snapshot as sufficient authorization", async () => {
    canApproveAuthorization.mockResolvedValue(true);
    const tx = transaction();
    configureRetryAuthorizationRevocation(tx);

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "manager-1" }))
      .rejects.toMatchObject({ message: "AUTHORIZATION_NOT_APPROVED" });

    expect(tx.purchase.findUnique).not.toHaveBeenCalled();
  });
});
