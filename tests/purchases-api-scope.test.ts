import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeApprovedPurchaseReceipt: vi.fn(),
  requestPurchaseReceipt: vi.fn(),
}));

vi.mock("../src/core/purchases", () => mocks);

import { postPurchaseExecution, postPurchaseRequest } from "../src/api/purchases";

describe("purchase API authorization boundary", () => {
  it("maps executor scope violations to HTTP 403", async () => {
    mocks.executeApprovedPurchaseReceipt.mockRejectedValue(new Error("AUTHORIZATION_SCOPE_FORBIDDEN"));

    const result = await postPurchaseExecution({ requestId: "auth-1", executorId: "user-1" });

    expect(result).toEqual({ status: 403, body: { error: "AUTHORIZATION_SCOPE_FORBIDDEN" } });
  });

  it("does not leak unknown execution errors", async () => {
    mocks.executeApprovedPurchaseReceipt.mockRejectedValue(new Error("DATABASE_SECRET"));

    const result = await postPurchaseExecution({ requestId: "auth-1", executorId: "user-1" });

    expect(result).toEqual({ status: 500, body: { error: "DATABASE_SECRET" } });
  });

  it("maps requester branch authorization failures to HTTP 403", async () => {
    mocks.requestPurchaseReceipt.mockRejectedValue(new Error("REQUESTER_BRANCH_INVALID"));

    const result = await postPurchaseRequest({
      branchId: "branch-1",
      requestedById: "user-1",
      employeeId: "emp-1",
      supplierId: "supplier-1",
      folio: "FAC-1",
      reason: "Resurtido",
      items: [{ productId: "product-1", quantity: 1, unitCost: 10 }],
    });

    expect(result).toEqual({ status: 403, body: { error: "REQUESTER_BRANCH_INVALID" } });
  });
});
