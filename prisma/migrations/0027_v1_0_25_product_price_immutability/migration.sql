-- ProductPrice is a point-in-time pricing ledger.
-- Historical and scheduled price events must not be mutated or deleted.
-- A correction is represented by a new authorized price event, preserving
-- the original record for auditability and historical reconstruction.

CREATE OR REPLACE FUNCTION prevent_product_price_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PRODUCT_PRICE_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS product_price_immutable_update
ON "ProductPrice";

DROP TRIGGER IF EXISTS product_price_immutable_delete
ON "ProductPrice";

CREATE TRIGGER product_price_immutable_update
BEFORE UPDATE ON "ProductPrice"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_price_mutation();

CREATE TRIGGER product_price_immutable_delete
BEFORE DELETE ON "ProductPrice"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_price_mutation();
