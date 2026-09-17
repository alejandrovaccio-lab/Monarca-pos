-- InventoryMovement.userId is an operational provenance field.
-- If present, the user must belong to the movement organization and have
-- explicit access to the movement branch. This prevents a valid user from
-- another branch from being attached to a movement as its executor.

CREATE OR REPLACE FUNCTION prevent_inventory_movement_user_scope_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."userId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "User" u
      JOIN "Branch" b ON b.id = NEW."branchId"
      WHERE u.id = NEW."userId"
        AND u."organizationId" = b."organizationId"
    ) THEN
      RAISE EXCEPTION 'INVENTORY_MOVEMENT_USER_SCOPE_FORBIDDEN';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM "UserBranchAccess" uba
      WHERE uba."userId" = NEW."userId"
        AND uba."branchId" = NEW."branchId"
    ) THEN
      RAISE EXCEPTION 'INVENTORY_MOVEMENT_USER_BRANCH_ACCESS_FORBIDDEN';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_user_scope ON "InventoryMovement";

CREATE TRIGGER inventory_movement_user_scope
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_user_scope_violation();
