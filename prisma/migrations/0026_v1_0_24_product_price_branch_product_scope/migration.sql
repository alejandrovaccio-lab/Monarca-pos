-- Branch-specific ProductPrice records are only valid for an enabled
-- BranchProduct assignment. Global prices remain product-scoped and do not
-- require a branch assignment.

CREATE OR REPLACE FUNCTION prevent_product_price_branch_product_scope_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."branchId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "Branch" b
      JOIN "Product" p ON p."id" = NEW."productId"
      JOIN "BranchProduct" bp
        ON bp."branchId" = NEW."branchId"
       AND bp."productId" = NEW."productId"
       AND bp."isEnabled" = TRUE
      WHERE b."id" = NEW."branchId"
        AND b."organizationId" = p."organizationId"
    ) THEN
      RAISE EXCEPTION 'PRODUCT_PRICE_BRANCH_PRODUCT_SCOPE_FORBIDDEN';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_price_branch_product_scope
ON "ProductPrice";

CREATE TRIGGER product_price_branch_product_scope
BEFORE INSERT OR UPDATE ON "ProductPrice"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_price_branch_product_scope_violation();
