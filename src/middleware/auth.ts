import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";
import { getSessionContext } from "../core/context";

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function requireSession(token: string) {
  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, revokedAt: true }
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  await prisma.userSession.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() }
  });

  return getSessionContext(session.id);
}

export async function requireBranchSession(token: string, branchId: string) {
  if (!branchId) return null;

  const context = await requireSession(token);
  if (!context || context.branchId !== branchId) return null;

  return context;
}
