CREATE OR REPLACE FUNCTION enforce_sale_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" <> 'COMPLETED'
       OR NEW."status" NOT IN ('CANCELLED', 'REFUNDED') THEN
      RAISE EXCEPTION 'SALE_STATUS_TRANSITION_FORBIDDEN';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sale_status_transition_integrity ON "Sale";

CREATE TRIGGER sale_status_transition_integrity
BEFORE UPDATE OF "status" ON "Sale"
FOR EACH ROW
EXECUTE FUNCTION enforce_sale_status_transition();
