import { prisma } from "../lib/prisma";

export async function canAccessBranch(userId: string, branchId: string) {
  if (!userId || !branchId) return false;

  const [user, branch] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true, status: true }
    }),
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { organizationId: true }
    })
  ]);

  if (!user || user.status !== "ACTIVE" || !branch) return false;
  if (user.organizationId !== branch.organizationId) return false;

  const access = await prisma.userBranchAccess.findUnique({
    where: { userId_branchId: { userId, branchId } }
  });

  return Boolean(access);
}
