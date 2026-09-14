import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeApprovedPurchaseReceipt: vi.fn(),
  requestPurchaseReceipt: vi.fn(),
}));

vi.mock("../src/core/purchases", () => mocks);

import { postPurchaseExecution } from "../src/api/purchases";

describe("purchase requestId security boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty requestId before reaching the purchase core", async () => {
    const result = await postPurchaseExecution({ requestId: "", executorId: "user-1" });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_REQUEST_ID_INVALID" } });
    expect(mocks.executeApprovedPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("accepts requestId at the 128-character limit", async () => {
    mocks.executeApprovedPurchaseReceipt.mockResolvedValue({ id: "purchase-1" });
    const requestId = "r".repeat(128);

    const result = await postPurchaseExecution({ requestId, executorId: "user-1" });

    expect(result).toEqual({ status: 200, body: { id: "purchase-1" } });
    expect(mocks.executeApprovedPurchaseReceipt).toHaveBeenCalledWith({ requestId, executorId: "user-1" });
  });

  it("rejects requestId over the 128-character limit before reaching the purchase core", async () => {
    const requestId = "r".repeat(129);

    const result = await postPurchaseExecution({ requestId, executorId: "user-1" });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_REQUEST_ID_INVALID" } });
    expect(mocks.executeApprovedPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("rejects a non-string requestId at runtime", async () => {
    const result = await postPurchaseExecution({ requestId: 123 as unknown as string, executorId: "user-1" });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_REQUEST_ID_INVALID" } });
    expect(mocks.executeApprovedPurchaseReceipt).not.toHaveBeenCalled();
  });
});
