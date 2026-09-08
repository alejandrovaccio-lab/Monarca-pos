import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { requestAuthorization } from "./authorization";

type CashMovementType = "CASH_IN" | "CASH_OUT";

type CashMovementRow = {
  id: string;
  registerSessionId: string;
  branchId: string;
  requestedById: string;
  authorizationRequestId: string;
  type: CashMovementType;
  amount: unknown;
  reason: string;
  createdAt: Date;
};

function assertAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("CASH_MOVEMENT_AMOUNT_INVALID");
}

function assertType(type: string): asserts type is CashMovementType {
  if (type !== "CASH_IN" && type !== "CASH_OUT") throw new Error("CASH_MOVEMENT_TYPE_INVALID");
}

async function getSessionContext(sessionId: string) {
  const session = await prisma.registerSession.findUnique({
    where: { id: sessionId },
    include: { register: { include: { branch: true } } },
  });
  if (!session) throw new Error("REGISTER_SESSION_NOT_FOUND");
  if (session.closedAt) throw new Error("REGISTER_SESSION_ALREADY_CLOSED");
  return session;
}

async function assertUserBranchAccess(userId: string, branchId: string, organizationId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      branchAccess: { where: { branchId }, select: { branchId: true } },
    },
  });
  if (!user || user.status !== "ACTIVE" || user.organizationId !== organizationId) throw new Error("USER_NOT_AUTHORIZED");
  if (!user.branchAccess.length) throw new Error("BRANCH_ACCESS_REQUIRED");
}

export async function requestCashMovement(input: {
  sessionId: string;
  requestedById: string;
  type: CashMovementType;
  amount: number;
  reason: string;
}) {
  assertType(input.type);
  assertAmount(input.amount);
  if (!input.reason?.trim()) throw new Error("CASH_MOVEMENT_REASON_REQUIRED");

  const session = await getSessionContext(input.sessionId);
  await assertUserBranchAccess(input.requestedById, session.register.branchId, session.register.branch.organizationId);

  return requestAuthorization({
    organizationId: session.register.branch.organizationId,
    branchId: session.register.branchId,
    requestedById: input.requestedById,
    type: "REGISTER_EXCEPTION",
    reason: input.reason.trim(),
    entityType: "CashMovement",
    requestedData: {
      registerSessionId: session.id,
      branchId: session.register.branchId,
      type: input.type,
      amount: Number(input.amount.toFixed(2)),
      reason: input.reason.trim(),
    },
  });
}

export async function executeApprovedCashMovement(input: {
  authorizationRequestId: string;
  executedById: string;
}) {
  const request = await prisma.authorizationRequest.findUnique({
    where: { id: input.authorizationRequestId },
  });
  if (!request) throw new Error("AUTHORIZATION_NOT_FOUND");
  if (request.type !== "REGISTER_EXCEPTION") throw new Error("CASH_MOVEMENT_AUTHORIZATION_TYPE_INVALID");
  if (request.status !== "APPROVED") throw new Error("AUTHORIZATION_NOT_APPROVED");
  if (!request.requestedData || typeof request.requestedData !== "object") throw new Error("CASH_MOVEMENT_DATA_INVALID");

  const data = request.requestedData as Record<string, unknown>;
  const sessionId = String(data.registerSessionId ?? "");
  const branchId = String(data.branchId ?? "");
  const type = String(data.type ?? "");
  const amount = Number(data.amount);
  const reason = String(data.reason ?? "").trim();
  assertType(type);
  assertAmount(amount);
  if (!sessionId || !branchId || !reason) throw new Error("CASH_MOVEMENT_DATA_INVALID");

  const session = await getSessionContext(sessionId);
  if (session.register.branchId !== branchId || request.branchId !== branchId) throw new Error("CASH_MOVEMENT_BRANCH_INVALID");
  await assertUserBranchAccess(input.executedById, branchId, session.register.branch.organizationId);

  const movementId = randomUUID();
  return prisma.$transaction(async (tx) => {
    // Lock the session so a close cannot race with execution of this movement.
    await tx.$queryRaw`SELECT "id" FROM "RegisterSession" WHERE "id" = ${session.id} FOR UPDATE`;

    const existing = await tx.$queryRaw<CashMovementRow[]>`
      SELECT "id", "registerSessionId", "branchId", "requestedById", "authorizationRequestId", "type", "amount", "reason", "createdAt"
      FROM "CashMovement"
      WHERE "authorizationRequestId" = ${request.id}
      LIMIT 1
    `;
    if (existing.length) return existing[0];

    const inserted = await tx.$queryRaw<CashMovementRow[]>`
      INSERT INTO "CashMovement" (
        "id", "registerSessionId", "branchId", "requestedById", "authorizationRequestId", "type", "amount", "reason"
      ) VALUES (
        ${movementId}::uuid, ${session.id}::uuid, ${branchId}::uuid, ${request.requestedById}::uuid,
        ${request.id}::uuid, ${type}, ${Number(amount.toFixed(2))}, ${reason}
      )
      RETURNING "id", "registerSessionId", "branchId", "requestedById", "authorizationRequestId", "type", "amount", "reason", "createdAt"
    `;
    const movement = inserted[0];

    await tx.authorizationRequest.update({
      where: { id: request.id },
      data: { entityId: movement.id },
    });

    await tx.auditLog.create({
      data: {
        organizationId: session.register.branch.organizationId,
        branchId,
        userId: input.executedById,
        action: "CASH_MOVEMENT_EXECUTED",
        entityType: "CashMovement",
        entityId: movement.id,
        afterData: { type, amount, reason, authorizationRequestId: request.id },
      },
    });

    return movement;
  });
}

export async function listCashMovements(input: { sessionId: string; requestedById: string }) {
  const session = await getSessionContext(input.sessionId);
  await assertUserBranchAccess(input.requestedById, session.register.branchId, session.register.branch.organizationId);
  return prisma.$queryRaw<CashMovementRow[]>`
    SELECT "id", "registerSessionId", "branchId", "requestedById", "authorizationRequestId", "type", "amount", "reason", "createdAt"
    FROM "CashMovement"
    WHERE "registerSessionId" = ${session.id}
    ORDER BY "createdAt" ASC
  `;
}

export async function getCashMovementTotals(sessionId: string) {
  const rows = await prisma.$queryRaw<Array<{ cashIn: unknown; cashOut: unknown }>>`
    SELECT
      COALESCE(SUM(CASE WHEN "type" = 'CASH_IN' THEN "amount" ELSE 0 END), 0) AS "cashIn",
      COALESCE(SUM(CASE WHEN "type" = 'CASH_OUT' THEN "amount" ELSE 0 END), 0) AS "cashOut"
    FROM "CashMovement"
    WHERE "registerSessionId" = ${sessionId}
  `;
  return {
    cashIn: Number(rows[0]?.cashIn ?? 0),
    cashOut: Number(rows[0]?.cashOut ?? 0),
  };
}
