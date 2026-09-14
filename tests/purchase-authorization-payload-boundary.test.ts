import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canApproveAuthorization: vi.fn(),
  authorizationIntegrityHash: vi.fn((input: unknown) => JSON.stringify(input)),
  findUniqueAuthorization: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../src/core/authorization", () => ({
  canApproveAuthorization: mocks.canApproveAuthorization,
  authorizationIntegrityHash: mocks.authorizationIntegrityHash,
  requestAuthorization: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    authorizationRequest: { findUnique: mocks.findUniqueAuthorization },
    $transaction: mocks.transaction,
  },
}));

import { executeApprovedPurchaseReceipt } from "../src/core/purchases";

const validRequestedData = () => ({
  purchaseId: "purchase-1",
  branchId: "branch-1",
  supplierId: "supplier-1",
  folio: "F-001",
  employeeId: "employee-1",
  purchasedAt: new Date().toISOString(),
  items: [{ productId: "product-1", quantity: 2, unitCost: 10, taxRate: 16 }],
});

const baseAuthorization = (requestedData: unknown, integrityHash?: string | null) => {
  const authorization = {
    id: "auth-1",
    status: "APPROVED",
    entityType: "Purchase",
    entityId: "purchase-1",
    organizationId: "org-1",
    branchId: "branch-1",
    requestedById: "requester-1",
    type: "OTHER",
    requestedData,
    beforeData: null,
    reason: "Compra autorizada",
    integrityHash: null as string | null,
  };
  const hashInput = {
    organizationId: authorization.organizationId,
    branchId: authorization.branchId,
    requestedById: authorization.requestedById,
    type: authorization.type,
    reason: authorization.reason,
    entityType: authorization.entityType,
    entityId: authorization.entityId,
    beforeData: authorization.beforeData,
    requestedData: authorization.requestedData,
  };
  return { ...authorization, integrityHash: integrityHash === undefined ? mocks.authorizationIntegrityHash(hashInput) : integrityHash };
};

describe("purchase execution persisted authorization payload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a non-object requestedData before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(baseAuthorization(null));

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization payload with more than 100 items before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(
      baseAuthorization({ ...validRequestedData(), items: Array.from({ length: 101 }, () => ({ productId: "product-1", quantity: 1, unitCost: 1 })) }),
    );

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization payload with an oversized product identifier before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(
      baseAuthorization({ ...validRequestedData(), items: [{ productId: "p".repeat(129), quantity: 1, unitCost: 1 }] }),
    );

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization payload with an invalid numeric item value before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(
      baseAuthorization({ ...validRequestedData(), items: [{ productId: "product-1", quantity: Number.POSITIVE_INFINITY, unitCost: 1 }] }),
    );

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization payload with an oversized folio before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(
      baseAuthorization({ ...validRequestedData(), folio: "F".repeat(129) }),
    );

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts the configured maximum item count at the payload boundary", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    const requestedData = {
      ...validRequestedData(),
      items: Array.from({ length: 100 }, (_, index) => ({ productId: `product-${index}`, quantity: 1, unitCost: 1 })),
    };
    mocks.findUniqueAuthorization.mockResolvedValue(baseAuthorization(requestedData));
    mocks.transaction.mockResolvedValue({ id: "purchase-1" });

    const result = await executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" });

    expect(result).toEqual({ id: "purchase-1" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("accepts an approved authorization with a matching integrity hash", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(baseAuthorization(validRequestedData()));
    mocks.transaction.mockResolvedValue({ id: "purchase-1" });

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .resolves.toEqual({ id: "purchase-1" });
    expect(mocks.authorizationIntegrityHash).toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing integrity hash before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(baseAuthorization(validRequestedData(), null));

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an altered integrity hash before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(baseAuthorization(validRequestedData(), "tampered-hash"));

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects changed requestedData after approval before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    const original = validRequestedData();
    const authorization = baseAuthorization(original);
    authorization.requestedData = { ...original, folio: "F-002" };
    mocks.findUniqueAuthorization.mockResolvedValue(authorization);

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
