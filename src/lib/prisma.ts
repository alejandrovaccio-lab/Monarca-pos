import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var monarcaPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.monarcaPrisma ??
  new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.monarcaPrisma = prisma;
}
