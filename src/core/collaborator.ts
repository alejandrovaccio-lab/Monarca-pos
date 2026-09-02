import { prisma } from "../lib/prisma";

export async function getCollaboratorById(id: string) {
  return prisma.user.findUnique({
    where: { id }
  });
}

export async function listCollaborators(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId },
    orderBy: { name: "asc" }
  });
}
