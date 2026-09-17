import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ProductPrice tenant integrity", () => {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/0022_v1_0_20_product_price_tenant_integrity/migration.sql"),
    "utf8",
  );

  it("requires same-tenant branch/product pairing for branch-specific prices", () => {
    expect(migration).toContain('NEW."branchId" IS NOT NULL');
    expect(migration).toContain('b."organizationId" = p."organizationId"');
    expect(migration).toContain("PRODUCT_PRICE_TENANT_SCOPE_FORBIDDEN");
  });

  it("allows global prices only when the referenced product exists", () => {
    // The migration's ELSE branch is the explicit global-price path
    // (equivalent to NEW.branchId IS NULL) and must validate the product.
    expect(migration).toContain("ELSE");
    expect(migration).toContain('FROM "Product" p');
    expect(migration).toContain("PRODUCT_PRICE_PRODUCT_INVALID");
  });

  it("protects both inserts and updates at database level", () => {
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "ProductPrice"');
    expect(migration).toContain("product_price_tenant_integrity");
  });
});
