-- InventoryMovement.employeeId is an operational provenance field.
-- If present, the employee must belong to the movement branch at the movement timestamp.
-- This closes the remaining database-level branch-scope gap after the tenant integrity trigger.

CREATE OR REPLACE FUNCTION prevent_inventory_movement_employee_scope_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.employeeId IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "Employee" e
      JOIN "Branch" b ON b.id = NEW.branchId
      WHERE e.id = NEW.employeeId
        AND e.organizationId = b.organizationId
    ) THEN
      RAISE EXCEPTION 'INVENTORY_MOVEMENT_EMPLOYEE_SCOPE_FORBIDDEN';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM "EmployeeAssignment" ea
      WHERE ea.employeeId = NEW.employeeId
        AND ea.branchId = NEW.branchId
        AND ea.startsAt <= NEW.occurredAt
        AND (ea.endsAt IS NULL OR NEW.occurredAt < ea.endsAt)
    ) THEN
      RAISE EXCEPTION 'INVENTORY_MOVEMENT_EMPLOYEE_ASSIGNMENT_FORBIDDEN';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_employee_scope ON "InventoryMovement";

CREATE TRIGGER inventory_movement_employee_scope
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_employee_scope_violation();
