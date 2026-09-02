import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma";
import { verifyPassword } from "./password";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { email, status: "ACTIVE" },
    include: { roles: { include: { role: true } } }
  });
  if (!user) return null;

  const credential = await prisma.authCredential.findUnique({ where: { userId: user.id } });
  if (!credential) return null;

  if (!(await verifyPassword(credential.passwordHash, password))) return null;
  return user;
}

export async function createSession(userId: string, branchId?: string, days = 7) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + days * 86400000);
  const session = await prisma.userSession.create({
    data: { userId, branchId, tokenHash: hashToken(token), expiresAt }
  });
  return { sessionId: session.id, token, expiresAt };
}

export async function revokeSession(token: string) {
  return prisma.userSession.update({
    where: { tokenHash: hashToken(token) },
    data: { revokedAt: new Date() }
  });
}
