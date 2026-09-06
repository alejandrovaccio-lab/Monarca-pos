-- Order lifecycle: RECEIVED -> PREPARING -> READY -> PAID -> DELIVERED -> COMPLETED
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';

-- Sensitive order quantity/weight corrections use the authorization workflow.
ALTER TYPE "AuthorizationType" ADD VALUE IF NOT EXISTS 'ORDER_ADJUSTMENT';

-- The original quantity remains the customer-requested quantity.
-- actualQuantity records what was actually weighed/fulfilled at preparation.
ALTER TABLE "OrderItem"
ADD COLUMN "actualQuantity" DECIMAL(14,4);
