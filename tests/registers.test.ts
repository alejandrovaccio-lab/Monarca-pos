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

describe("register sessions", () => {
  it("opens a closed register with an opening float and audit trail", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" });
    db.user.findUnique.mockResolvedValue({ id: "user-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
    db.register.findUnique.mockResolvedValue({ id: "register-1", branchId: "branch-1", status: "CLOSED", name: "Caja 1", code: "C1" });
    db.register.updateMany.mockResolvedValue({ count: 1 });
    db.registerSession.create.mockResolvedValue({ id: "session-1", registerId: "register-1", openedById: "user-1", openingFloat: 500 });
    transactionMock();

    const result = await openRegisterSession({ branchId: "branch-1", registerId: "register-1", openedById: "user-1", openingFloat: 500 });

    expect(result.id).toBe("session-1");
    expect(db.register.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "OPEN" } }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "REGISTER_OPEN" }) }));
  });

  it("does not open a register that is already open", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" });
    db.user.findUnique.mockResolvedValue({ id: "user-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
    db.register.findUnique.mockResolvedValue({ id: "register-1", branchId: "branch-1", status: "OPEN" });

    await expect(openRegisterSession({ branchId: "branch-1", registerId: "register-1", openedById: "user-1", openingFloat: 500 })).rejects.toThrow("REGISTER_ALREADY_OPEN");
  });

  it("closes a session and calculates cash variance", async () => {
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
    db.payment.findMany.mockResolvedValue([{ amount: 1000 }, { amount: 250 }]);
    db.registerSession.updateMany.mockResolvedValue({ count: 1 });
    db.register.updateMany.mockResolvedValue({ count: 1 });
    transactionMock();

    const result = await closeRegisterSession({ sessionId: "session-1", closedById: "manager-1", closingTotal: 1700 });

    expect(result.expectedCash).toBe(1750);
    expect(result.cashSales).toBe(1250);
    expect(result.variance).toBe(-50);
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "REGISTER_CLOSE" }) }));
  });
});
