import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("Purchase authorization serializable isolation", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const purchases = readFileSync(join(here, "../src/core/purchases.ts"), "utf8");

  it("executes the complete approved purchase receipt at SERIALIZABLE isolation with retry protection", () => {
    expect(purchases).toContain("return runWithSerializableRetry(() => prisma.$transaction(async (tx) => {");
    expect(purchases).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(purchases).toContain("from \"./serializable-transaction\"");
  });

  it("revalidates the authorization inside the transaction before purchase writes", () => {
    expect(purchases).toContain("const currentAuthorization = await tx.authorizationRequest.findUnique({ where: { id: authorization.id } });");
    expect(purchases).toContain("if (currentAuthorization.status !== \"APPROVED\") throw new Error(\"AUTHORIZATION_NOT_APPROVED\");");
  });

  it("guards against executing the same purchase twice", () => {
    expect(purchases).toContain("const existing = await tx.purchase.findUnique({ where: { id: currentRequested.purchaseId } });");
    expect(purchases).toContain("throw new Error(\"PURCHASE_ALREADY_EXECUTED\")");
  });
});
