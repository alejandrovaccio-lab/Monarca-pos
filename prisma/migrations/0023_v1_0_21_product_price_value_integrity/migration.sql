-- ProductPrice.price is a monetary value and may be zero for valid pricing scenarios.
-- Negative prices are never valid and must be rejected at database level.
-- Future effectiveAt values remain allowed because scheduled pricing is a valid use case.

CREATE OR REPLACE FUNCTION prevent_product_price_value_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."price" < 0 THEN
    RAISE EXCEPTION 'PRODUCT_PRICE_NEGATIVE_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_price_value_integrity ON "ProductPrice";

CREATE TRIGGER product_price_value_integrity
BEFORE INSERT OR UPDATE ON "ProductPrice"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_price_value_violation();
