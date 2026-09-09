import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireBranchSession } = vi.hoisted(() => ({
  requireBranchSession: vi.fn(),
}));

const { postInventoryAdjustmentRequest, postInventoryAdjustmentExecution } = vi.hoisted(() => ({
  postInventoryAdjustmentRequest: vi.fn(),
  postInventoryAdjustmentExecution: vi.fn(),
}));

vi.mock("../src/middleware/auth", () => ({ requireBranchSession }));
vi.mock("../src/api/inventory-adjustments", () => ({
  postInventoryAdjustmentRequest,
  postInventoryAdjustmentExecution,
}));

import { handleRequest } from "../src/api/http";

function request(body: unknown) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    method: "POST",
    url: "/inventory/adjustments/execute",
    headers: { authorization: "Bearer session-token" },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  } as any;
}

function response() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as any;
}

describe("inventory adjustment HTTP boundary", () => {
  const context = {
    sessionId: "session-1",
    userId: "session-user",
    organizationId: "org-1",
    branchId: "branch-1",
    user: { id: "session-user", status: "ACTIVE" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireBranchSession.mockResolvedValue(context);
    postInventoryAdjustmentExecution.mockResolvedValue({
      status: 200,
      body: { id: "movement-1" },
    });
  });

  it("derives executorId from the authenticated session instead of the request body", async () => {
    const res = response();

    await handleRequest(
      request({
        branchId: "branch-1",
        requestId: "authorization-1",
        executorId: "attacker-user",
      }),
      res,
    );

    expect(requireBranchSession).toHaveBeenCalledWith("session-token", "branch-1");
    expect(postInventoryAdjustmentExecution).toHaveBeenCalledWith({
      requestId: "authorization-1",
      executorId: "session-user",
    });
  });

  it("rejects a branch spoof before reaching inventory execution", async () => {
    requireBranchSession.mockResolvedValue(null);
    const res = response();

    await handleRequest(
      request({
        branchId: "branch-2",
        requestId: "authorization-1",
        executorId: "attacker-user",
      }),
      res,
    );

    expect(postInventoryAdjustmentExecution).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
  });
});
