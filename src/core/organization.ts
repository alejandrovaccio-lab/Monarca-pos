import { prisma } from "../lib/prisma";

export async function getOrganizationById(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    include: { branches: true }
  });
}

export async function listOrganizations() {
  return prisma.organization.findMany({
    orderBy: { name: "asc" }
  });
}
