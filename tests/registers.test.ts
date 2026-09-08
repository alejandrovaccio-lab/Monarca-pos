import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    branch: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    register: { findUnique: vi.fn(), updateMany: vi.fn() },
    registerSession: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    payment: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../src/lib/prisma";
import { closeRegisterSession, openRegisterSession } from "../src/core/registers";

const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

function transactionMock() {
  db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(db));
}

function mockOpenDependencies() {
  db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" });
  db.user.findUnique.mockResolvedValue({ id: "user-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
  db.register.findUnique.mockResolvedValue({ id: "register-1", branchId: "branch-1", status: "CLOSED", name: "Caja 1", code: "C1" });
  db.register.updateMany.mockResolvedValue({ count: 1 });
  db.registerSession.create.mockResolvedValue({ id: "session-1", registerId: "register-1", openedById: "user-1", openingFloat: 500 });
  transactionMock();
}

describe("register sessions", () => {
  it("opens a closed register with an opening float and audit trail", async () => {
    mockOpenDependencies();

    const result = await openRegisterSession({ branchId: "branch-1", registerId: "register-1", openedById: "user-1", openingFloat: 500 });

    expect(result.id).toBe("session-1");
    expect(db.register.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "OPEN" } }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "REGISTER_OPEN" }) }));
  });

  it("rejects an invalid opening float", async () => {
    await expect(openRegisterSession({ branchId: "branch-1", registerId: "register-1", openedById: "user-1", openingFloat: -1 })).rejects.toThrow("OPENING_FLOAT_INVALID");
    expect(db.branch.findUnique).not.toHaveBeenCalled();
  });

  it("does not open a register that is already open", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" });
    db.user.findUnique.mockResolvedValue({ id: "user-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
    db.register.findUnique.mockResolvedValue({ id: "register-1", branchId: "branch-1", status: "OPEN" });

    await expect(openRegisterSession({ branchId: "branch-1", registerId: "register-1", openedById: "user-1", openingFloat: 500 })).rejects.toThrow("REGISTER_ALREADY_OPEN");
  });

  it("closes a session and calculates cash sales and variance", async () => {
    const branch = { id: "branch-1", organizationId: "org-1" };
    db.registerSession.findUnique.mockResolvedValue({
      id: "session-1",
      registerId: "register-1",
      openedById: "user-1",
      closedAt: null,
      openingFloat: 500,
      register: { id: "register-1", branchId: "branch-1", branch },
    });
    db.user.findUnique.mockResolvedValue({ id: "manager-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
    db.payment.findMany.mockResolvedValue([
      { amount: 1000, sale: { status: "COMPLETED" } },
      { amount: 250, sale: { status: "COMPLETED" } },
      { amount: 100, sale: { status: "REFUNDED" } },
      { amount: 999, sale: { status: "COMPLETED" } },
    ]);
    db.registerSession.updateMany.mockResolvedValue({ count: 1 });
    db.register.updateMany.mockResolvedValue({ count: 1 });
    transactionMock();

    const result = await closeRegisterSession({ sessionId: "session-1", closedById: "manager-1", closingTotal: 2649 });

    expect(result.cashSales).toBe(2249);
    expect(result.cashReversals).toBe(100);
    expect(result.expectedCash).toBe(2649);
    expect(result.variance).toBe(0);
    expect(db.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sale: expect.objectContaining({ status: { in: ["COMPLETED", "CANCELLED", "REFUNDED"] } }),
        method: "CASH",
      }),
    }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "REGISTER_CLOSE" }) }));
  });

  it("ignores non-cash payments and reports a shortage", async () => {
    const branch = { id: "branch-1", organizationId: "org-1" };
    db.registerSession.findUnique.mockResolvedValue({
      id: "session-2", registerId: "register-1", openedById: "user-1", closedAt: null, openingFloat: 300,
      register: { id: "register-1", branchId: "branch-1", branch },
    });
    db.user.findUnique.mockResolvedValue({ id: "manager-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
    db.payment.findMany.mockResolvedValue([{ amount: 200, sale: { status: "COMPLETED" } }, { amount: 500, sale: { status: "COMPLETED" } }]);
    db.registerSession.updateMany.mockResolvedValue({ count: 1 });
    db.register.updateMany.mockResolvedValue({ count: 1 });
    transactionMock();

    const result = await closeRegisterSession({ sessionId: "session-2", closedById: "manager-1", closingTotal: 450 });

    expect(result.expectedCash).toBe(1000);
    expect(result.variance).toBe(-550);
  });

  it("rejects an invalid closing total before touching the database", async () => {
    await expect(closeRegisterSession({ sessionId: "session-1", closedById: "manager-1", closingTotal: -0.01 })).rejects.toThrow("CLOSING_TOTAL_INVALID");
    expect(db.registerSession.findUnique).not.toHaveBeenCalled();
  });

  it("does not close an already closed session", async () => {
    db.registerSession.findUnique.mockResolvedValue({ id: "session-1", closedAt: new Date(), register: { branchId: "branch-1", branch: { organizationId: "org-1" } } });

    await expect(closeRegisterSession({ sessionId: "session-1", closedById: "manager-1", closingTotal: 500 })).rejects.toThrow("REGISTER_SESSION_ALREADY_CLOSED");
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
