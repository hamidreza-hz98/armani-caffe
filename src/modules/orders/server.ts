import "server-only";
export { OrderService } from "./application/service.ts";
export { MongoOrderRepository, type OrderPorts } from "./infrastructure/repository.ts";

// Server public boundary. Compose use cases and adapters here.
export { productSoldCounts } from "./infrastructure/product-sales.ts";
export { checkoutIntentSchema, orderSchema } from "./infrastructure/schema.ts";
