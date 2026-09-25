import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "0029_v1_0_27_sale_reversal_integrity",
  "migration.sql"
);

const migration = fs.readFileSync(migrationPath, "utf8");

describe("Sale reversal integrity", () => {
  it("requires the reversal to target the exact sale item", () => {
    expect(migration).toContain('si.id = NEW."referenceId"');
    expect(migration).toContain('si."productId" = NEW."productId"');
    expect(migration).toContain('s."branchId" = NEW."branchId"');
  });

  it("requires the reversal quantity to exactly match the sold item", () => {
    expect(migration).toContain('NEW."quantity" <> sale_item_quantity');
    expect(migration).toContain("SALE_REVERSAL_QUANTITY_MISMATCH");
  });

  it("forbids reversal timestamps before the original sale", () => {
    expect(migration).toContain('NEW."occurredAt" < sale_sold_at');
    expect(migration).toContain("SALE_REVERSAL_BEFORE_SALE_FORBIDDEN");
  });

  it("requires the sale terminal status to match the reversal type", () => {
    expect(migration).toContain("SALE_CANCEL_REVERSAL_STATUS_INVALID");
    expect(migration).toContain("SALE_REFUND_REVERSAL_STATUS_INVALID");
  });

  it("rejects non-positive reversal quantities", () => {
    expect(migration).toContain('NEW."quantity" IS NULL OR NEW."quantity" <= 0');
    expect(migration).toContain("SALE_REVERSAL_QUANTITY_INVALID");
  });
});
