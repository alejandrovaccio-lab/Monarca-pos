import { prisma } from "../lib/prisma";

export async function canAccessBranch(userId: string, branchId: string) {
  const access = await prisma.userBranchAccess.findUnique({
    where: { userId_branchId: { userId, branchId } }
  });
  return Boolean(access);
}
