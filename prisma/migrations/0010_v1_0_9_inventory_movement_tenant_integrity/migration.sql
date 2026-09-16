-- InventoryMovement must never connect records from different organizations.
-- The application already performs tenant checks; this database trigger makes
-- the invariant hold even if a movement is inserted outside the application.

CREATE OR REPLACE FUNCTION prevent_inventory_movement_tenant_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  branch_org uuid;
  product_org uuid;
  user_org uuid;
  employee_org uuid;
BEGIN
  SELECT "organizationId" INTO branch_org
  FROM "Branch"
  WHERE "id" = NEW."branchId";

  SELECT "organizationId" INTO product_org
  FROM "Product"
  WHERE "id" = NEW."productId";

  IF branch_org IS NULL OR product_org IS NULL OR branch_org <> product_org THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_TENANT_VIOLATION';
  END IF;

  IF NEW."userId" IS NOT NULL THEN
    SELECT "organizationId" INTO user_org
    FROM "User"
    WHERE "id" = NEW."userId";

    IF user_org IS NULL OR user_org <> branch_org THEN
      RAISE EXCEPTION 'INVENTORY_MOVEMENT_USER_SCOPE_VIOLATION';
    END IF;
  END IF;

  IF NEW."employeeId" IS NOT NULL THEN
    SELECT "organizationId" INTO employee_org
    FROM "Employee"
    WHERE "id" = NEW."employeeId";

    IF employee_org IS NULL OR employee_org <> branch_org THEN
      RAISE EXCEPTION 'INVENTORY_MOVEMENT_EMPLOYEE_SCOPE_VIOLATION';
    END IF;
  END IF;

  IF NEW."quantity" = 0 THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_ZERO_QUANTITY';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_movement_tenant_integrity
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_tenant_violation();
