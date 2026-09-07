import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBranchSession: vi.fn(),
  postCreateSaleFromOrder: vi.fn(),
}));

vi.mock("../src/middleware/auth", () => ({ requireBranchSession: mocks.requireBranchSession }));
vi.mock("../src/api/order-sale", () => ({ postCreateSaleFromOrder: mocks.postCreateSaleFromOrder }));

import { handleRequest } from "../src/api/http";

function requestFor(body: unknown, url = "/orders/order-1/sale") {
  const request = Readable.from([JSON.stringify(body)]) as Readable & { method: string; url: string; headers: Record<string, string> };
  request.method = "POST";
  request.url = url;
  request.headers = { authorization: "Bearer session-token" };
  return request;
}

function responseMock() {
  let body = "";
  let status = 0;
  const response = {
    writeHead(code: number) { status = code; return response; },
    end(value?: string) { body = value ?? ""; },
  } as any;
  return { response, get status() { return status; }, get body() { return body; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireBranchSession.mockResolvedValue({ userId: "cashier-authenticated", branchId: "branch-1" });
  mocks.postCreateSaleFromOrder.mockResolvedValue({ order: { id: "order-1", status: "PAID" }, sale: { id: "sale-1", total: "34.40" }, usedQuantities: [] });
});

describe("HTTP order to sale", () => {
  it("creates a sale from the authenticated cashier and never trusts a body cashier id", async () => {
    const result = responseMock();
    await handleRequest(requestFor({
      branchId: "branch-1",
      registerSessionId: "session-1",
      cashierId: "attacker-supplied-cashier",
      sellerId: "seller-1",
      payments: [{ method: "CASH", amount: "34.40" }],
      soldAt: "2026-09-07T19:00:00.000Z",
    }), result.response);

    expect(result.status).toBe(201);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({ sale: expect.objectContaining({ id: "sale-1" }) }));
    expect(mocks.postCreateSaleFromOrder).toHaveBeenCalledWith({
      branchId: "branch-1",
      orderId: "order-1",
      registerSessionId: "session-1",
      cashierId: "cashier-authenticated",
      sellerId: "seller-1",
      payments: [{ method: "CASH", amount: "34.40" }],
      soldAt: "2026-09-07T19:00:00.000Z",
    });
  });

  it("requires an authenticated operational branch before creating the sale", async () => {
    mocks.requireBranchSession.mockResolvedValue(null);
    const result = responseMock();

    await handleRequest(requestFor({ branchId: "branch-1", registerSessionId: "session-1", payments: [{ method: "CASH", amount: "1.00" }] }), result.response);

    expect(result.status).toBe(401);
    expect(JSON.parse(result.body)).toEqual({ error: "AUTHENTICATION_REQUIRED" });
    expect(mocks.postCreateSaleFromOrder).not.toHaveBeenCalled();
  });

  it("requires the branch id in the request body", async () => {
    const result = responseMock();

    await handleRequest(requestFor({ registerSessionId: "session-1", payments: [{ method: "CASH", amount: "1.00" }] }), result.response);

    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ error: "BRANCH_ID_REQUIRED" });
    expect(mocks.requireBranchSession).not.toHaveBeenCalled();
    expect(mocks.postCreateSaleFromOrder).not.toHaveBeenCalled();
  });
});
