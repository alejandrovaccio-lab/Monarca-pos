import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthorizationDecisionApprover, postAuthorizationDecision } = vi.hoisted(() => ({
  requireAuthorizationDecisionApprover: vi.fn(),
  postAuthorizationDecision: vi.fn(),
}));

vi.mock("../src/middleware/authorization", () => ({ requireAuthorizationDecisionApprover }));
vi.mock("../src/api/authorization", () => ({ postAuthorizationDecision, postAuthorizationRequest: vi.fn() }));
vi.mock("../src/api/auth", () => ({ getMe: vi.fn(), postLogin: vi.fn(), postLogout: vi.fn() }));
vi.mock("../src/middleware/auth", () => ({ requireBranchSession: vi.fn() }));
vi.mock("../src/api/inventory-query", () => ({ getInventory: vi.fn(), getInventoryList: vi.fn(), getInventoryMovements: vi.fn(), getInventoryReplenishmentQuery: vi.fn() }));
vi.mock("../src/api/physical-counts", () => ({ postPhysicalCountExecution: vi.fn(), postPhysicalCountRequest: vi.fn() }));
vi.mock("../src/api/purchases", () => ({ postPurchaseExecution: vi.fn(), postPurchaseRequest: vi.fn() }));
vi.mock("../src/api/registers", () => ({ postOpenRegister: vi.fn(), postCloseRegister: vi.fn() }));
vi.mock("../src/api/sales-create", () => ({ postCreateSale: vi.fn() }));
vi.mock("../src/api/sales-ticket", () => ({ getSaleTicketQuery: vi.fn() }));
vi.mock("../src/api/sales-ticket-print", () => ({ getSaleTicketPrintQuery: vi.fn() }));
vi.mock("../src/api/orders", () => ({ getOrders: vi.fn(), postCreateOrder: vi.fn(), postOrderAdjustmentExecution: vi.fn(), postOrderAdjustmentRequest: vi.fn(), postOrderSaleLink: vi.fn(), postOrderStatus: vi.fn() }));
vi.mock("../src/api/order-intake", () => ({ postOrderIntake: vi.fn() }));
vi.mock("../src/api/order-sale", () => ({ postCreateSaleFromOrder: vi.fn() }));
vi.mock("../src/api/customers", () => ({ getCustomerQuery: vi.fn(), getCustomers: vi.fn(), patchCustomer: vi.fn(), postCreateCustomer: vi.fn() }));

import { handleRequest } from "../src/api/http";

function request(path: string, body: unknown = {}, token = "session-token") {
  const payload = JSON.stringify(body);
  const stream = Readable.from([payload]);
  return Object.assign(stream, {
    method: "POST",
    url: path,
    headers: { cookie: `monarca_session=${encodeURIComponent(token)}` },
  }) as any;
}

function response() {
  return {
    status: 0,
    body: "",
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) { this.status = status; this.headers = headers; },
    end(body?: string) { this.body = body ?? ""; },
  } as any;
}

describe("HTTP authorization input boundary", () => {
  const approverContext = {
    sessionId: "session-2",
    userId: "manager-1",
    branchId: "branch-1",
    user: { id: "manager-1", organizationId: "org-1", status: "ACTIVE" },
  };

  beforeEach(() => vi.clearAllMocks());

  it("rejects malformed authorization request ids without touching the session boundary", async () => {
    const res = response();

    await handleRequest(request("/authorizations/%E0%A4%A/decision", { decision: "APPROVED" }), res);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "INVALID_REQUEST_ID" });
    expect(requireAuthorizationDecisionApprover).not.toHaveBeenCalled();
    expect(postAuthorizationDecision).not.toHaveBeenCalled();
  });

  it("rejects a null authorization decision body after authentication", async () => {
    requireAuthorizationDecisionApprover.mockResolvedValue(approverContext);
    const res = response();

    await handleRequest(request("/authorizations/auth-1/decision", null), res);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "INVALID_REQUEST" });
    expect(postAuthorizationDecision).not.toHaveBeenCalled();
  });

  it("rejects an array authorization decision body after authentication", async () => {
    requireAuthorizationDecisionApprover.mockResolvedValue(approverContext);
    const res = response();

    await handleRequest(request("/authorizations/auth-1/decision", ["APPROVED"]), res);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "INVALID_REQUEST" });
    expect(postAuthorizationDecision).not.toHaveBeenCalled();
  });
});
