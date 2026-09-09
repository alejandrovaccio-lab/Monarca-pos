import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireBranchSession, requireBranchAuthorizationApprover, postAuthorizationRequest, postAuthorizationDecision, postInventoryAdjustmentRequest, postInventoryAdjustmentExecution } = vi.hoisted(() => ({
  requireBranchSession: vi.fn(),
  requireBranchAuthorizationApprover: vi.fn(),
  postAuthorizationRequest: vi.fn(),
  postAuthorizationDecision: vi.fn(),
  postInventoryAdjustmentRequest: vi.fn(),
  postInventoryAdjustmentExecution: vi.fn(),
}));

vi.mock("../src/middleware/auth", () => ({ requireBranchSession }));
vi.mock("../src/middleware/authorization", () => ({ requireBranchAuthorizationApprover }));
vi.mock("../src/api/authorization", () => ({ postAuthorizationRequest, postAuthorizationDecision }));
vi.mock("../src/api/inventory-adjustments", () => ({ postInventoryAdjustmentRequest, postInventoryAdjustmentExecution }));
vi.mock("../src/api/auth", () => ({ getMe: vi.fn(), postLogin: vi.fn(), postLogout: vi.fn() }));
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

function request(method: string, path: string, body?: unknown, token = "session-token") {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const stream = Readable.from(payload ? [payload] : []);
  return Object.assign(stream, {
    method,
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

describe("HTTP authorization boundary", () => {
  const context = {
    sessionId: "session-1",
    userId: "cashier-1",
    branchId: "branch-1",
    user: { id: "cashier-1", organizationId: "org-1", status: "ACTIVE" },
  };
  const approverContext = {
    sessionId: "session-2",
    userId: "manager-1",
    branchId: "branch-1",
    user: { id: "manager-1", organizationId: "org-1", status: "ACTIVE" },
  };

  beforeEach(() => vi.clearAllMocks());

  it("rejects an authorization request without a valid branch session", async () => {
    requireBranchSession.mockResolvedValue(null);
    const res = response();

    await handleRequest(request("POST", "/authorizations", { branchId: "branch-1", requestedById: "attacker", organizationId: "org-evil", reason: "test" }), res);

    expect(res.status).toBe(401);
    expect(postAuthorizationRequest).not.toHaveBeenCalled();
  });

  it("derives requester, organization and branch from the authenticated session", async () => {
    requireBranchSession.mockResolvedValue(context);
    postAuthorizationRequest.mockResolvedValue({ status: 201, body: { id: "auth-1" } });
    const res = response();

    await handleRequest(request("POST", "/authorizations", { branchId: "branch-1", requestedById: "attacker", organizationId: "org-evil", type: "CASH_MOVEMENT", reason: "authorized reason", entityType: "REGISTER", entityId: "register-1" }), res);

    expect(res.status).toBe(201);
    expect(postAuthorizationRequest).toHaveBeenCalledWith(expect.objectContaining({ requestedById: "cashier-1", organizationId: "org-1", branchId: "branch-1" }));
  });

  it("rejects a spoofed branch before reaching the authorization core", async () => {
    requireBranchSession.mockResolvedValue(null);
    const res = response();

    await handleRequest(request("POST", "/authorizations", { branchId: "branch-2", requestedById: "attacker", organizationId: "org-evil", reason: "test" }), res);

    expect(res.status).toBe(401);
    expect(postAuthorizationRequest).not.toHaveBeenCalled();
  });

  it("requires an authenticated approver before resolving an authorization", async () => {
    requireBranchAuthorizationApprover.mockResolvedValue(null);
    const res = response();

    await handleRequest(request("POST", "/authorizations/auth-1/decision", { branchId: "branch-1", approverId: "attacker", decision: "APPROVED" }), res);

    expect(res.status).toBe(403);
    expect(postAuthorizationDecision).not.toHaveBeenCalled();
  });

  it("derives the approver identity from the authenticated session", async () => {
    requireBranchAuthorizationApprover.mockResolvedValue(approverContext);
    postAuthorizationDecision.mockResolvedValue({ status: 200, body: { ok: true } });
    const res = response();

    await handleRequest(request("POST", "/authorizations/auth-1/decision", { branchId: "branch-1", approverId: "attacker", decision: "APPROVED", notes: "approved" }), res);

    expect(res.status).toBe(200);
    expect(postAuthorizationDecision).toHaveBeenCalledWith({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED", notes: "approved" });
  });

  it("does not resolve an authorization when the branch session is invalid", async () => {
    requireBranchAuthorizationApprover.mockResolvedValue(null);
    const res = response();

    await handleRequest(request("POST", "/authorizations/auth-1/decision", { branchId: "branch-2", decision: "APPROVED" }, "bad-token"), res);

    expect(res.status).toBe(403);
    expect(postAuthorizationDecision).not.toHaveBeenCalled();
  });

  it("validates the decision before invoking the authorization core", async () => {
    requireBranchAuthorizationApprover.mockResolvedValue(approverContext);
    const res = response();

    await handleRequest(request("POST", "/authorizations/auth-1/decision", { branchId: "branch-1" }), res);

    expect(res.status).toBe(400);
    expect(postAuthorizationDecision).not.toHaveBeenCalled();
  });

  it("derives the inventory adjustment requester from the authenticated session", async () => {
    requireBranchSession.mockResolvedValue(context);
    postInventoryAdjustmentRequest.mockResolvedValue({ status: 201, body: { id: "auth-inventory-1" } });
    const res = response();

    await handleRequest(request("POST", "/inventory/adjustments", {
      branchId: "branch-1",
      requestedById: "attacker",
      organizationId: "org-evil",
      productId: "product-1",
      employeeId: "employee-1",
      type: "WASTE",
      quantity: 2,
      reason: "merma",
    }), res);

    expect(res.status).toBe(201);
    expect(postInventoryAdjustmentRequest).toHaveBeenCalledWith(expect.objectContaining({
      branchId: "branch-1",
      requestedById: "cashier-1",
    }));
  });

  it("rejects a spoofed inventory adjustment branch before execution", async () => {
    requireBranchSession.mockResolvedValue(null);
    const res = response();

    await handleRequest(request("POST", "/inventory/adjustments/execute", {
      branchId: "branch-2",
      requestId: "auth-inventory-1",
      executorId: "attacker",
    }), res);

    expect(res.status).toBe(401);
    expect(postInventoryAdjustmentExecution).not.toHaveBeenCalled();
  });

  it("derives the inventory adjustment executor from the authenticated session", async () => {
    requireBranchSession.mockResolvedValue(context);
    postInventoryAdjustmentExecution.mockResolvedValue({ status: 200, body: { ok: true } });
    const res = response();

    await handleRequest(request("POST", "/inventory/adjustments/execute", {
      branchId: "branch-1",
      requestId: "auth-inventory-1",
      executorId: "attacker",
      organizationId: "org-evil",
    }), res);

    expect(res.status).toBe(200);
    expect(postInventoryAdjustmentExecution).toHaveBeenCalledWith({
      requestId: "auth-inventory-1",
      executorId: "cashier-1",
    });
  });

  it("uses the session branch and identity even when the client spoofs both", async () => {
    requireBranchSession.mockResolvedValue(context);
    postInventoryAdjustmentExecution.mockResolvedValue({ status: 200, body: { ok: true } });
    const res = response();

    await handleRequest(request("POST", "/inventory/adjustments/execute", {
      branchId: "branch-1",
      requestId: "auth-inventory-1",
      executorId: "manager-1",
      organizationId: "org-evil",
    }), res);

    expect(postInventoryAdjustmentExecution).toHaveBeenCalledWith({ requestId: "auth-inventory-1", executorId: "cashier-1" });
    expect(postInventoryAdjustmentExecution).not.toHaveBeenCalledWith(expect.objectContaining({ executorId: "manager-1" }));
  });
});
