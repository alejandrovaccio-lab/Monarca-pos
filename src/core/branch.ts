import { prisma } from "../lib/prisma";

export async function getBranchById(id: string) {
  return prisma.branch.findUnique({
    where: { id }
  });
}

export async function listBranches(organizationId: string) {
  return prisma.branch.findMany({
    where: { organizationId },
    orderBy: { name: "asc" }
  });
}
