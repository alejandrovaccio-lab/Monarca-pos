import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "0026_v1_0_24_product_price_branch_product_scope",
  "migration.sql"
);

const migration = fs.readFileSync(migrationPath, "utf8");

describe("ProductPrice branch product scope", () => {
  it("requires an enabled BranchProduct for branch-specific prices", () => {
    expect(migration).toContain('JOIN "BranchProduct" bp');
    expect(migration).toContain('bp."branchId" = NEW."branchId"');
    expect(migration).toContain('bp."productId" = NEW."productId"');
    expect(migration).toContain('bp."isEnabled" = TRUE');
    expect(migration).toContain(
      "PRODUCT_PRICE_BRANCH_PRODUCT_SCOPE_FORBIDDEN"
    );
  });

  it("keeps the branch and product inside the same tenant", () => {
    expect(migration).toContain('b."organizationId" = p."organizationId"');
  });

  it("protects both inserts and updates at the database boundary", () => {
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE ON "ProductPrice"'
    );
  });

  it("does not require a branch assignment for global prices", () => {
    expect(migration).toContain('IF NEW."branchId" IS NOT NULL THEN');
    expect(migration).toContain(
      "Global prices remain product-scoped and do not"
    );
  });
});
