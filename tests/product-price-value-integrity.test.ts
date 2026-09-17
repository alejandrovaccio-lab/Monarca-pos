import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ProductPrice value integrity", () => {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/0023_v1_0_21_product_price_value_integrity/migration.sql"),
    "utf8",
  );

  it("allows zero price", () => {
    expect(migration).not.toContain('NEW."price" <= 0');
    expect(migration).toContain('NEW."price" < 0');
  });

  it("rejects negative prices with a dedicated error", () => {
    expect(migration).toContain("PRODUCT_PRICE_NEGATIVE_FORBIDDEN");
  });

  it("protects inserts and updates at database level", () => {
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "ProductPrice"');
    expect(migration).toContain("product_price_value_integrity");
  });

  it("does not impose a future effectiveAt restriction", () => {
    expect(migration).not.toContain('NEW."effectiveAt" > CURRENT_TIMESTAMP');
    expect(migration).not.toContain("PRODUCT_PRICE_FUTURE_TIMESTAMP_FORBIDDEN");
  });
});
