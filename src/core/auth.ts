import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma";
import { verifyPassword } from "./password";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function login(email: string, password: string, branchId?: string) {
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), status: "ACTIVE" },
    include: { roles: { include: { role: true } } }
  });
  if (!user) return null;
  const credential = await prisma.authCredential.findUnique({ where: { userId: user.id } });
  if (!credential || !(await verifyPassword(credential.passwordHash, password))) return null;

  if (branchId) {
    const access = await prisma.userBranchAccess.findUnique({
      where: { userId_branchId: { userId: user.id, branchId } }
    });
    if (!access) return null;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  const session = await prisma.userSession.create({
    data: { userId: user.id, branchId, tokenHash: hashToken(token), expiresAt }
  });
  return { sessionId: session.id, token, expiresAt };
}

export async function logout(token: string) {
  return prisma.userSession.update({
    where: { tokenHash: hashToken(token) },
    data: { revokedAt: new Date() }
  });
}
