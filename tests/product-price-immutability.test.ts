import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "0027_v1_0_25_product_price_immutability",
  "migration.sql"
);

const migration = fs.readFileSync(migrationPath, "utf8");

describe("ProductPrice immutability", () => {
  it("defines a shared mutation guard", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION prevent_product_price_mutation()"
    );
    expect(migration).toContain("PRODUCT_PRICE_IMMUTABLE");
  });

  it("blocks updates at the database boundary", () => {
    expect(migration).toContain(
      'BEFORE UPDATE ON "ProductPrice"'
    );
    expect(migration).toContain(
      "product_price_immutable_update"
    );
  });

  it("blocks deletes at the database boundary", () => {
    expect(migration).toContain(
      'BEFORE DELETE ON "ProductPrice"'
    );
    expect(migration).toContain(
      "product_price_immutable_delete"
    );
  });

  it("does not block inserts", () => {
    expect(migration).not.toContain(
      'BEFORE INSERT ON "ProductPrice"'
    );
    expect(migration).not.toContain(
      'BEFORE INSERT OR UPDATE ON "ProductPrice"'
    );
  });
});
