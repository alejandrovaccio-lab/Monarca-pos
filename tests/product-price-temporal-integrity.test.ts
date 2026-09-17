import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "0024_v1_0_22_product_price_temporal_integrity",
  "migration.sql"
);

const migration = fs.readFileSync(migrationPath, "utf8");

describe("ProductPrice temporal integrity", () => {
  it("rejects a future createdAt at database level", () => {
    expect(migration).toContain('NEW."createdAt" > CURRENT_TIMESTAMP');
    expect(migration).toContain("PRODUCT_PRICE_CREATED_AT_FUTURE_FORBIDDEN");
  });

  it("protects INSERT and UPDATE with a database trigger", () => {
    expect(migration).toContain("BEFORE INSERT OR UPDATE ON \"ProductPrice\"");
    expect(migration).toContain("product_price_timestamp_integrity");
  });

  it("keeps effectiveAt schedulable and does not reject future effective dates", () => {
    expect(migration).not.toContain('NEW."effectiveAt" > CURRENT_TIMESTAMP');
    expect(migration).not.toContain("PRODUCT_PRICE_EFFECTIVE_AT_FUTURE_FORBIDDEN");
  });
});
