import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/0011_v1_0_10_inventory_movement_employee_scope/migration.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("inventory movement employee temporal scope", () => {
  it("requires the employee assignment to belong to the same employee and branch", () => {
    expect(migration).toContain('ea.employeeId = NEW.employeeId');
    expect(migration).toContain('ea.branchId = NEW.branchId');
  });

  it("allows a movement exactly at assignment startsAt", () => {
    expect(migration).toContain("ea.startsAt <= NEW.occurredAt");
  });

  it("rejects a movement before assignment startsAt", () => {
    expect(migration).toContain("ea.startsAt <= NEW.occurredAt");
  });

  it("allows an open-ended assignment after startsAt", () => {
    expect(migration).toContain("ea.endsAt IS NULL");
  });

  it("rejects a movement exactly at assignment endsAt", () => {
    expect(migration).toContain("NEW.occurredAt < ea.endsAt");
  });

  it("therefore models assignments as a half-open interval [startsAt, endsAt)", () => {
    expect(migration).toContain("ea.startsAt <= NEW.occurredAt");
    expect(migration).toContain("(ea.endsAt IS NULL OR NEW.occurredAt < ea.endsAt)");
  });

  it("does not allow a later branch assignment to justify an earlier movement", () => {
    expect(migration).toContain("ea.startsAt <= NEW.occurredAt");
  });
});
