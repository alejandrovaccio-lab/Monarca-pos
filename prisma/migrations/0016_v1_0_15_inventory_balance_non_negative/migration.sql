-- InventoryBalance is the materialized current stock for a branch/product.
-- Negative stock is not a valid persisted state; corrections must be represented
-- by explicit inventory movements and may not bypass this invariant.

CREATE OR REPLACE FUNCTION prevent_inventory_balance_negative_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."quantity" < 0 THEN
    RAISE EXCEPTION 'INVENTORY_BALANCE_NEGATIVE_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_balance_non_negative ON "InventoryBalance";

CREATE TRIGGER inventory_balance_non_negative
BEFORE INSERT OR UPDATE ON "InventoryBalance"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_balance_negative_violation();
