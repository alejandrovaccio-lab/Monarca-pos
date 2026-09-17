-- ProductCost is historical cost provenance.
-- Cost corrections must be represented by a new effective record rather than
-- rewriting or deleting historical cost evidence.

CREATE OR REPLACE FUNCTION prevent_product_cost_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PRODUCT_COST_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS product_cost_immutable_update ON "ProductCost";
DROP TRIGGER IF EXISTS product_cost_immutable_delete ON "ProductCost";

CREATE TRIGGER product_cost_immutable_update
BEFORE UPDATE ON "ProductCost"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_cost_mutation();

CREATE TRIGGER product_cost_immutable_delete
BEFORE DELETE ON "ProductCost"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_cost_mutation();
