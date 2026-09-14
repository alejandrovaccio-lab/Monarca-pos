import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    authorizationRequest: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));

vi.mock("../src/core/authorization", () => ({
  canApproveAuthorization: vi.fn(async () => true),
  requestAuthorization: vi.fn(),
  authorizationIntegrityHash: vi.fn(() => "test-integrity-hash"),
}));

import { executeApprovedPurchaseReceipt } from "../src/core/purchases";

describe("purchase authorization transaction atomicity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-fetches authorization through the transaction client before purchase writes", async () => {
    const authorization = {
      id: "auth-1",
      status: "APPROVED",
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "user-1",
      type: "PURCHASE_EXECUTION",
      reason: "approved purchase",
      entityType: "PURCHASE",
      entityId: "purchase-1",
      beforeData: null,
      requestedData: {
        purchaseId: "purchase-1",
        branchId: "branch-1",
        items: [{ productId: "product-1", quantity: 1, unitCost: 10 }],
      },
      integrityHash: "test-integrity-hash",
    };

    const tx = {
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
      user: { findUnique: vi.fn() },
    };

    db.authorizationRequest.findUnique.mockResolvedValue(authorization);
    db.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    try {
      await executeApprovedPurchaseReceipt({
        requestId: authorization.id,
        executorId: "user-1",
      } as never);
    } catch {
      // The test is focused on the authorization transaction boundary.
    }

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.authorizationRequest.findUnique).toHaveBeenCalledWith({
      where: { id: authorization.id },
    });
  });

  it("does not use the pre-transaction authorization as the source for transaction-time validation", async () => {
    const authorization = {
      id: "auth-2",
      status: "APPROVED",
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "user-1",
      type: "PURCHASE_EXECUTION",
      reason: "approved purchase",
      entityType: "PURCHASE",
      entityId: "purchase-2",
      beforeData: null,
      requestedData: {
        purchaseId: "purchase-2",
        branchId: "branch-1",
        items: [{ productId: "product-1", quantity: 1, unitCost: 10 }],
      },
      integrityHash: "test-integrity-hash",
    };

    const currentAuthorization = { ...authorization, status: "REJECTED" };
    const tx = {
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(currentAuthorization) },
      user: { findUnique: vi.fn() },
    };

    db.authorizationRequest.findUnique.mockResolvedValue(authorization);
    db.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(
      executeApprovedPurchaseReceipt({
        requestId: authorization.id,
        executorId: "user-1",
      } as never),
    ).rejects.toThrow("AUTHORIZATION_NOT_APPROVED");

    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });
});
