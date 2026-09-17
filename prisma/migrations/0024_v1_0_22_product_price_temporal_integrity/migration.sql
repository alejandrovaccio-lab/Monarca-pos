-- ProductPrice timestamps must be internally coherent.
-- createdAt is the ledger insertion timestamp and may never be in the future.
-- effectiveAt may be historical or future because scheduled pricing is supported.

CREATE OR REPLACE FUNCTION prevent_product_price_timestamp_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."createdAt" > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'PRODUCT_PRICE_CREATED_AT_FUTURE_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_price_timestamp_integrity ON "ProductPrice";

CREATE TRIGGER product_price_timestamp_integrity
BEFORE INSERT OR UPDATE ON "ProductPrice"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_price_timestamp_violation();
