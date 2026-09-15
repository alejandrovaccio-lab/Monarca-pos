import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";
import { getSessionContext } from "../core/context";
import { setAuthenticatedContext } from "../core/auth-context";

const MAX_AUTH_TOKEN_LENGTH = 256;
const MAX_AUTH_BRANCH_ID_LENGTH = 128;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function isValidToken(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && token.length <= MAX_AUTH_TOKEN_LENGTH;
}

function isValidIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_AUTH_BRANCH_ID_LENGTH;
}

export async function requireSession(token: string) {
  if (!isValidToken(token)) return null;

  const now = new Date();
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, revokedAt: true }
  });

  if (!session || session.revokedAt || session.expiresAt <= now) {
    return null;
  }

  const context = await getSessionContext(session.id);
  if (!context || context.user.status !== "ACTIVE") {
    return null;
  }

  const touch = await prisma.userSession.updateMany({
    where: {
      id: session.id,
      revokedAt: null,
      expiresAt: { gt: now }
    },
    data: { lastSeenAt: now }
  });

  if (touch.count !== 1) return null;

  return context;
}

export async function requireBranchSession(token: string, branchId: string) {
  if (!isValidToken(token) || !isValidIdentifier(branchId)) return null;

  const context = await requireSession(token);
  if (!context || context.branchId !== branchId) return null;

  setAuthenticatedContext({
    userId: context.userId,
    branchId: context.branchId,
    organizationId: context.user.organizationId,
  });

  return context;
}
