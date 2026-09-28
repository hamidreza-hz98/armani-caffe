// Browser-safe public boundary. Export only contracts and pure domain types.
export type { PaymentIssue, PaymentView } from "./domain/framework.ts";
export { selectProvider } from "./domain/framework.ts";
export * from "./domain/index.ts";
