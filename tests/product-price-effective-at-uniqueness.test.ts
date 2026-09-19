import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "0025_v1_0_23_product_price_effective_at_uniqueness",
  "migration.sql"
);

const migration = fs.readFileSync(migrationPath, "utf8");

describe("ProductPrice effectiveAt uniqueness", () => {
  it("prevents duplicate branch-specific price events", () => {
    expect(migration).toContain(
      'ON "ProductPrice" ("productId", "branchId", "effectiveAt")'
    );
    expect(migration).toContain("WHERE "branchId" IS NOT NULL");
    expect(migration).toContain("product_price_branch_effective_unique");
  });

  it("prevents duplicate global price events", () => {
    expect(migration).toContain(
      'ON "ProductPrice" ("productId", "effectiveAt")'
    );
    expect(migration).toContain("WHERE "branchId" IS NULL");
    expect(migration).toContain("product_price_global_effective_unique");
  });

  it("keeps global and branch-specific pricing as separate scopes", () => {
    expect(migration).toContain("Global prices (branchId NULL)");
    expect(migration).toContain("branch-specific prices remain independent");
  });

  it("uses database-level unique indexes rather than mutable application state", () => {
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
    expect(migration).not.toContain("CREATE TRIGGER");
  });
});
