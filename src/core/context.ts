import { prisma } from "../lib/prisma";

export async function getSessionContext(sessionId: string) {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: {
      user: { include: { roles: { include: { role: true } }, branchAccess: true } },
      branch: true
    }
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;
  if (!session.branchId || !session.branch) return null;
  if (session.branch.organizationId !== session.user.organizationId) return null;
  if (!session.user.branchAccess.some(({ branchId }) => branchId === session.branchId)) return null;

  return {
    sessionId: session.id,
    userId: session.userId,
    branchId: session.branchId,
    user: session.user,
    branch: session.branch,
    roles: session.user.roles.map((r) => r.role.name)
  };
}
