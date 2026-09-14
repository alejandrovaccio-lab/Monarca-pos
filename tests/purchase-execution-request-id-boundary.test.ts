import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeApprovedPurchaseReceipt: vi.fn(),
  requestPurchaseReceipt: vi.fn(),
}));

vi.mock("../src/core/purchases", () => mocks);

import { postPurchaseExecution } from "../src/api/purchases";

describe("purchase execution requestId security boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a whitespace-only requestId before reaching the purchase core", async () => {
    const result = await postPurchaseExecution({ requestId: "   ", executorId: "user-1" });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_REQUEST_ID_INVALID" } });
    expect(mocks.executeApprovedPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("accepts a requestId at the configured maximum length", async () => {
    mocks.executeApprovedPurchaseReceipt.mockResolvedValue({ id: "purchase-1" });
    const input = { requestId: "r".repeat(128), executorId: "user-1" };

    const result = await postPurchaseExecution(input);

    expect(result).toEqual({ status: 200, body: { id: "purchase-1" } });
    expect(mocks.executeApprovedPurchaseReceipt).toHaveBeenCalledWith(input);
  });

  it("rejects a requestId above the configured maximum", async () => {
    const result = await postPurchaseExecution({ requestId: "r".repeat(129), executorId: "user-1" });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_REQUEST_ID_INVALID" } });
    expect(mocks.executeApprovedPurchaseReceipt).not.toHaveBeenCalled();
  });
});
