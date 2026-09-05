import { prisma } from "../lib/prisma";

export async function openRegisterSession(input: {
  branchId: string;
  registerId: string;
  openedById: string;
  openingFloat: number;
}) {
  if (input.openingFloat < 0 || !Number.isFinite(input.openingFloat)) throw new Error("OPENING_FLOAT_INVALID");

  const [branch, user, register] = await Promise.all([
    prisma.branch.findUnique({ where: { id: input.branchId }, select: { id: true, organizationId: true } }),
    prisma.user.findUnique({
      where: { id: input.openedById },
      select: { id: true, organizationId: true, status: true, branchAccess: { where: { branchId: input.branchId }, select: { branchId: true } } },
    }),
    prisma.register.findUnique({ where: { id: input.registerId }, select: { id: true, branchId: true, status: true, name: true, code: true } }),
  ]);

  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  if (!user || user.status !== "ACTIVE" || user.organizationId !== branch.organizationId) throw new Error("USER_NOT_AUTHORIZED");
  if (!user.branchAccess.length) throw new Error("BRANCH_ACCESS_REQUIRED");
  if (!register || register.branchId !== branch.id) throw new Error("REGISTER_NOT_FOUND");
  if (register.status !== "CLOSED") throw new Error("REGISTER_ALREADY_OPEN");

  return prisma.$transaction(async (tx) => {
    const opened = await tx.register.updateMany({
      where: { id: register.id, branchId: branch.id, status: "CLOSED" },
      data: { status: "OPEN" },
    });
    if (opened.count !== 1) throw new Error("REGISTER_ALREADY_OPEN");

    const session = await tx.registerSession.create({
      data: { registerId: register.id, openedById: input.openedById, openingFloat: input.openingFloat },
    });

    await tx.auditLog.create({
      data: {
        organizationId: branch.organizationId,
        branchId: branch.id,
        userId: input.openedById,
        action: "REGISTER_OPEN",
        entityType: "RegisterSession",
        entityId: session.id,
        afterData: { registerId: register.id, openingFloat: input.openingFloat },
      },
    });

    return session;
  });
}

export async function closeRegisterSession(input: { sessionId: string; closedById: string; closingTotal: number }) {
  if (input.closingTotal < 0 || !Number.isFinite(input.closingTotal)) throw new Error("CLOSING_TOTAL_INVALID");

  const session = await prisma.registerSession.findUnique({
    where: { id: input.sessionId },
    include: { register: { include: { branch: true } } },
  });
  if (!session) throw new Error("REGISTER_SESSION_NOT_FOUND");
  if (session.closedAt) throw new Error("REGISTER_SESSION_ALREADY_CLOSED");

  const closer = await prisma.user.findUnique({
    where: { id: input.closedById },
    select: { id: true, organizationId: true, status: true, branchAccess: { where: { branchId: session.register.branchId }, select: { branchId: true } } },
  });
  if (!closer || closer.status !== "ACTIVE" || closer.organizationId !== session.register.branch.organizationId) throw new Error("USER_NOT_AUTHORIZED");
  if (!closer.branchAccess.length) throw new Error("BRANCH_ACCESS_REQUIRED");

  const payments = await prisma.payment.findMany({
    where: { sale: { registerSessionId: session.id, status: "COMPLETED" }, method: "CASH" },
    select: { amount: true },
  });
  const cashSales = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const expectedCash = Number(session.openingFloat) + cashSales;
  const variance = Number((input.closingTotal - expectedCash).toFixed(2));

  return prisma.$transaction(async (tx) => {
    const closed = await tx.registerSession.updateMany({
      where: { id: session.id, closedAt: null },
      data: { closedAt: new Date(), closedById: input.closedById, closingTotal: input.closingTotal },
    });
    if (closed.count !== 1) throw new Error("REGISTER_SESSION_ALREADY_CLOSED");

    const registerClosed = await tx.register.updateMany({
      where: { id: session.registerId, status: "OPEN" },
      data: { status: "CLOSED" },
    });
    if (registerClosed.count !== 1) throw new Error("REGISTER_STATE_INVALID");

    await tx.auditLog.create({
      data: {
        organizationId: session.register.branch.organizationId,
        branchId: session.register.branchId,
        userId: input.closedById,
        action: "REGISTER_CLOSE",
        entityType: "RegisterSession",
        entityId: session.id,
        beforeData: { openingFloat: Number(session.openingFloat), expectedCash },
        afterData: { closingTotal: input.closingTotal, variance },
      },
    });

    return { ...session, closedAt: new Date(), closedById: input.closedById, closingTotal: input.closingTotal, expectedCash, cashSales, variance };
  });
}
