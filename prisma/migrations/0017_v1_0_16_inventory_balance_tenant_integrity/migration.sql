-- InventoryBalance is tenant-scoped materialized stock.
-- A balance may only pair a branch and product that belong to the same organization.
-- This protects the persisted stock state even if application-level checks are bypassed.

CREATE OR REPLACE FUNCTION prevent_inventory_balance_tenant_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Branch" b
    JOIN "Product" p ON p."id" = NEW."productId"
    WHERE b."id" = NEW."branchId"
      AND b."organizationId" = p."organizationId"
  ) THEN
    RAISE EXCEPTION 'INVENTORY_BALANCE_TENANT_SCOPE_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_balance_tenant_integrity ON "InventoryBalance";

CREATE TRIGGER inventory_balance_tenant_integrity
BEFORE INSERT OR UPDATE ON "InventoryBalance"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_balance_tenant_violation();
