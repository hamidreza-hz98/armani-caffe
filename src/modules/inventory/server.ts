import "server-only";

// Server public boundary. Compose use cases and adapters here.
export {
  inventoryItemSchema,
  inventoryMovementSchema,
  productConsumptionRuleSchema,
  stockApprovalRequestSchema,
} from "./infrastructure/schema.ts";
