import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";
import { getSessionContext } from "../core/context";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requireSession(token: string) {
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true }
  });
  if (!session) return null;
  return getSessionContext(session.id);
}

export async function requireBranchSession(token: string, branchId: string) {
  const context = await requireSession(token);
  if (!context || context.branchId !== branchId) return null;
  return context;
}
