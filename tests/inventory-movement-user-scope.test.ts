import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/0015_v1_0_14_inventory_movement_user_scope/migration.sql"
  ),
  "utf8"
);

describe("InventoryMovement user scope integrity", () => {
  it("requires the provenance user to belong to the movement branch organization", () => {
    expect(migration).toContain('u."organizationId" = b."organizationId"');
    expect(migration).toContain("INVENTORY_MOVEMENT_USER_SCOPE_FORBIDDEN");
  });

  it("requires explicit user access to the movement branch", () => {
    expect(migration).toContain('FROM "UserBranchAccess" uba');
    expect(migration).toContain('uba."userId" = NEW."userId"');
    expect(migration).toContain('uba."branchId" = NEW."branchId"');
    expect(migration).toContain("INVENTORY_MOVEMENT_USER_BRANCH_ACCESS_FORBIDDEN");
  });

  it("does not apply a user-scope check when userId is absent", () => {
    expect(migration).toContain('IF NEW."userId" IS NOT NULL');
  });

  it("enforces the rule at database insert time", () => {
    expect(migration).toContain(
      "DROP TRIGGER IF EXISTS inventory_movement_user_scope"
    );
    expect(migration).toContain(
      "CREATE TRIGGER inventory_movement_user_scope"
    );
    expect(migration).toContain('BEFORE INSERT ON "InventoryMovement"');
    expect(migration).toContain(
      "prevent_inventory_movement_user_scope_violation()"
    );
  });
});
