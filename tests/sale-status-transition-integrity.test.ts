import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "0028_v1_0_26_sale_status_transition_integrity",
  "migration.sql"
);

const migration = fs.readFileSync(migrationPath, "utf8");

describe("Sale status transition integrity", () => {
  it("allows only COMPLETED to CANCELLED or REFUNDED", () => {
    expect(migration).toContain('OLD."status" <> \'COMPLETED\'');
    expect(migration).toContain('NEW."status" NOT IN (\'CANCELLED\', \'REFUNDED\')');
    expect(migration).toContain("SALE_STATUS_TRANSITION_FORBIDDEN");
  });

  it("protects status changes at database level", () => {
    expect(migration).toContain('BEFORE UPDATE OF "status" ON "Sale"');
    expect(migration).toContain("sale_status_transition_integrity");
  });

  it("keeps the terminal states terminal", () => {
    expect(migration).toContain("OLD.\"status\" <> 'COMPLETED'");
    expect(migration).toContain("NEW.\"status\" NOT IN ('CANCELLED', 'REFUNDED')");
  });
});
