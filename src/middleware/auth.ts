import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";
import { getSessionContext } from "../core/context";

const MAX_AUTH_TOKEN_LENGTH = 256;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function isValidToken(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && token.length <= MAX_AUTH_TOKEN_LENGTH;
}

export async function requireSession(token: string) {
  if (!isValidToken(token)) return null;

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, revokedAt: true }
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  const context = await getSessionContext(session.id);
  if (!context || context.user.status === "INACTIVE") {
    return null;
  }

  await prisma.userSession.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() }
  });

  return context;
}

export async function requireBranchSession(token: string, branchId: string) {
  if (!isValidToken(token) || typeof branchId !== "string" || branchId.length === 0) return null;

  const context = await requireSession(token);
  if (!context || context.branchId !== branchId) return null;

  return context;
}
