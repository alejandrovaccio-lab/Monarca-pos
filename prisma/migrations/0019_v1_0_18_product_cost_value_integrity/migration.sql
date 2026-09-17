-- ProductCost is historical monetary valuation.
-- A persisted cost may be zero, but it must never be negative.
-- This database-level invariant complements purchase input validation and
-- protects historical cost records from bypassing the application layer.

CREATE OR REPLACE FUNCTION prevent_product_cost_negative_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."cost" < 0 THEN
    RAISE EXCEPTION 'PRODUCT_COST_NEGATIVE_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_cost_value_integrity ON "ProductCost";

CREATE TRIGGER product_cost_value_integrity
BEFORE INSERT ON "ProductCost"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_cost_negative_violation();
