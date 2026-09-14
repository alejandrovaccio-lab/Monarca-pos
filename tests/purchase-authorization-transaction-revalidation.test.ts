import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    authorizationRequest: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/core/authorization", () => ({
  canApproveAuthorization: vi.fn(),
  requestAuthorization: vi.fn(),
  authorizationIntegrityHash: vi.fn(() => "test-integrity-hash"),
}));

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization } from "../src/core/authorization";
import { executeApprovedPurchaseReceipt } from "../src/core/purchases";

const db = prisma as any;

const authorization = {
  id: "auth-1",
  status: "APPROVED",
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "requester-1",
  type: "OTHER",
  entityType: "Purchase",
  entityId: "purchase-1",
  reason: "Compra autorizada",
  beforeData: null,
  integrityHash: "test-integrity-hash",
  requestedData: {
    purchaseId: "purchase-1",
    branchId: "branch-1",
    supplierId: "supplier-1",
    folio: "FAC-100",
    employeeId: "emp-1",
    purchasedAt: new Date().toISOString(),
    items: [{ productId: "product-1", quantity: 1, unitCost: 10 }],
  },
};

function setup(currentAuthorization = authorization) {
  vi.mocked(canApproveAuthorization).mockImplementation(async () => true);
  db.authorizationRequest.findUnique.mockResolvedValue(authorization);
  const tx = {
    authorizationRequest: { findUnique: vi.fn().mockResolvedValue(currentAuthorization) },
    user: { findUnique: vi.fn() },
  };
  db.$transaction.mockImplementation(async (callback: any) => callback(tx));
  return tx;
}

beforeEach(() => vi.clearAllMocks());

describe("purchase authorization transaction revalidation", () => {
  it("rejects authorization status changed after the pre-transaction check", async () => {
    const current = { ...authorization, status: "REJECTED" };
    setup(current);

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_NOT_APPROVED");
  });

  it("rejects authorization scope changed after the pre-transaction check", async () => {
    const current = { ...authorization, branchId: "branch-2" };
    setup(current);

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
  });

  it("rejects authorization payload changed after the pre-transaction check", async () => {
    const current = {
      ...authorization,
      requestedData: {
        ...authorization.requestedData,
        items: [{ productId: "product-2", quantity: 99, unitCost: 1 }],
      },
    };
    setup(current);

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
  });

  it("rejects a transaction-time integrity hash mismatch", async () => {
    setup({ ...authorization, integrityHash: "changed-hash" });

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
  });

  it("does not load the executor when the authorization becomes invalid inside the transaction", async () => {
    const tx = setup({ ...authorization, status: "REJECTED" });

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_NOT_APPROVED");
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });
});
