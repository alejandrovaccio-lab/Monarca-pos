import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const salesPath = path.join(process.cwd(), "src", "core", "sales.ts");
const sales = fs.readFileSync(salesPath, "utf8");

describe("Sale reversal serializable isolation", () => {
  it("imports Prisma transaction isolation support", () => {
    expect(sales).toContain('import { Prisma } from "@prisma/client";');
  });

  it("executes the complete approved sale change at SERIALIZABLE isolation", () => {
    expect(sales).toContain("runSerializableTransaction(() => prisma.$transaction(async (tx) => {");
    expect(sales).toContain("Prisma.TransactionIsolationLevel.Serializable");
  });

  it("keeps the authorization row lock inside the serializable transaction", () => {
    expect(sales).toContain('await tx.$queryRaw`SELECT "id" FROM "AuthorizationRequest" WHERE "id" = ${authorization.id} FOR UPDATE`;');
  });

  it("performs sale, inventory and audit writes through the transaction client", () => {
    expect(sales).toContain("await tx.sale.updateMany({");
    expect(sales).toContain("await tx.inventoryBalance.upsert({");
    expect(sales).toContain("await tx.inventoryMovement.create({");
    expect(sales).toContain("await tx.auditLog.create({");
  });
});
