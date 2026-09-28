// Browser-safe public boundary. Export only contracts and pure domain types.
export type { CheckoutView, OrderView, StockLine } from "./domain/confirmation.ts";
export * from "./domain/index.ts";
export { makeOrderItemSnapshot } from "./domain/model.ts";
