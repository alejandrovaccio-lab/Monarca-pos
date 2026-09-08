import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    registerSession: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/core/authorization", () => ({
  requestAuthorization: vi.fn(),
}));

import { prisma } from "../src/lib/prisma";
import { requestAuthorization } from "../src/core/authorization";
import { executeApprovedCashMovement, requestCashMovement } from "../src/core/cash-movements";

const db = prisma as any;
const mockRequestAuthorization = requestAuthorization as any;

beforeEach(() => vi.clearAllMocks());

function session() {
  return {
    id: "session-1",
    closedAt: null,
    register: {
      id: "register-1",
      branchId: "branch-1",
      branch: { id: "branch-1", organizationId: "org-1" },
    },
  };
}

function transactionMock() {
  db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(db));
}

describe("authorized cash movements", () => {
  it("creates a pending authorization instead of changing cash immediately", async () => {
    db.registerSession.findUnique.mockResolvedValue(session());
    db.user.findUnique.mockResolvedValue({ id: "user-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
    mockRequestAuthorization.mockResolvedValue({ id: "auth-1", status: "PENDING" });

    const result = await requestCashMovement({ sessionId: "session-1", requestedById: "user-1", type: "CASH_OUT", amount: 250, reason: "Compra urgente autorizable" });

    expect(result).toEqual({ id: "auth-1", status: "PENDING" });
    expect(mockRequestAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      type: "REGISTER_EXCEPTION",
      entityType: "CashMovement",
      requestedData: expect.objectContaining({ type: "CASH_OUT", amount: 250, registerSessionId: "session-1" }),
    }));
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid amount and type before creating authorization", async () => {
    await expect(requestCashMovement({ sessionId: "session-1", requestedById: "user-1", type: "CASH_OUT", amount: 0, reason: "x" })).rejects.toThrow("CASH_MOVEMENT_AMOUNT_INVALID");
    await expect(requestCashMovement({ sessionId: "session-1", requestedById: "user-1", type: "INVALID" as any, amount: 10, reason: "x" })).rejects.toThrow("CASH_MOVEMENT_TYPE_INVALID");
    expect(mockRequestAuthorization).not.toHaveBeenCalled();
  });

  it("executes an approved authorization once and audits the immutable movement", async () => {
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "auth-1",
      type: "REGISTER_EXCEPTION",
      status: "APPROVED",
      requestedById: "user-1",
      branchId: "branch-1",
      requestedData: { registerSessionId: "session-1", branchId: "branch-1", type: "CASH_IN", amount: 300, reason: "Cambio autorizado" },
    });
    db.registerSession.findUnique.mockResolvedValue(session());
    db.user.findUnique.mockResolvedValue({ id: "manager-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
    db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "movement-1", registerSessionId: "session-1", branchId: "branch-1", requestedById: "user-1", authorizationRequestId: "auth-1", type: "CASH_IN", amount: 300, reason: "Cambio autorizado", createdAt: new Date(),
      }]);
    db.authorizationRequest.update.mockResolvedValue({});
    transactionMock();

    const result = await executeApprovedCashMovement({ authorizationRequestId: "auth-1", executedById: "manager-1" });

    expect(result.id).toBe("movement-1");
    expect(db.authorizationRequest.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "auth-1" }, data: { entityId: "movement-1" } }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "CASH_MOVEMENT_EXECUTED", entityType: "CashMovement" }) }));
  });

  it("does not execute a pending authorization", async () => {
    db.authorizationRequest.findUnique.mockResolvedValue({ id: "auth-1", type: "REGISTER_EXCEPTION", status: "PENDING" });
    await expect(executeApprovedCashMovement({ authorizationRequestId: "auth-1", executedById: "manager-1" })).rejects.toThrow("AUTHORIZATION_NOT_APPROVED");
  });
});
