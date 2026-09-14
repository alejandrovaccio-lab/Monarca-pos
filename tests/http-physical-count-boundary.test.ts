import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireBranchSession, postPhysicalCountRequest, postPhysicalCountExecution } = vi.hoisted(() => ({
  requireBranchSession: vi.fn(),
  postPhysicalCountRequest: vi.fn(),
  postPhysicalCountExecution: vi.fn(),
}));

vi.mock("../src/middleware/auth", () => ({ requireBranchSession }));
vi.mock("../src/middleware/authorization", () => ({ requireAuthorizationDecisionApprover: vi.fn() }));
vi.mock("../src/api/physical-counts", () => ({ postPhysicalCountRequest, postPhysicalCountExecution }));
vi.mock("../src/api/auth", () => ({ getMe: vi.fn(), postLogin: vi.fn(), postLogout: vi.fn() }));
vi.mock("../src/api/authorization", () => ({ postAuthorizationRequest: vi.fn(), postAuthorizationDecision: vi.fn() }));
vi.mock("../src/api/inventory-query", () => ({ getInventory: vi.fn(), getInventoryList: vi.fn(), getInventoryMovements: vi.fn(), getInventoryReplenishmentQuery: vi.fn() }));
vi.mock("../src/api/inventory-adjustments", () => ({ postInventoryAdjustmentRequest: vi.fn(), postInventoryAdjustmentExecution: vi.fn() }));
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

function request(path: string, body: unknown) {
  const stream = Readable.from([JSON.stringify(body)]);
  return Object.assign(stream, {
    method: "POST",
    url: path,
    headers: { cookie: "monarca_session=session-token" },
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

describe("HTTP physical count identity boundary", () => {
  const context = {
    sessionId: "session-1",
    userId: "cashier-1",
    branchId: "branch-1",
    user: { id: "cashier-1", organizationId: "org-1", status: "ACTIVE" },
  };

  beforeEach(() => vi.clearAllMocks());

  it("derives the physical count requester from the authenticated session", async () => {
    requireBranchSession.mockResolvedValue(context);
    postPhysicalCountRequest.mockResolvedValue({ status: 201, body: { id: "auth-count-1" } });
    const res = response();

    await handleRequest(request("/inventory/physical-counts", {
      branchId: "branch-1",
      productId: "product-1",
      requestedById: "attacker",
      employeeId: "employee-1",
      countedQuantity: 7,
      reason: "conteo",
    }), res);

    expect(res.status).toBe(201);
    expect(postPhysicalCountRequest).toHaveBeenCalledWith({
      branchId: "branch-1",
      productId: "product-1",
      requestedById: "cashier-1",
      employeeId: "employee-1",
      countedQuantity: 7,
      reason: "conteo",
    });
  });

  it("derives the physical count executor from the authenticated session", async () => {
    requireBranchSession.mockResolvedValue(context);
    postPhysicalCountExecution.mockResolvedValue({ status: 200, body: { ok: true } });
    const res = response();

    await handleRequest(request("/inventory/physical-counts/execute", {
      branchId: "branch-1",
      requestId: "auth-count-1",
      executorId: "attacker",
    }), res);

    expect(res.status).toBe(200);
    expect(postPhysicalCountExecution).toHaveBeenCalledWith({
      requestId: "auth-count-1",
      executorId: "cashier-1",
    });
  });

  it("never lets a client-supplied branch or actor replace the authenticated branch and identity", async () => {
    requireBranchSession.mockResolvedValue(null);
    const res = response();

    await handleRequest(request("/inventory/physical-counts/execute", {
      branchId: "branch-2",
      requestId: "auth-count-1",
      executorId: "manager-1",
    }), res);

    expect(res.status).toBe(401);
    expect(postPhysicalCountExecution).not.toHaveBeenCalled();
  });
});
