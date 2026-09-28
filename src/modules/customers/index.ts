// Browser-safe public boundary. Export only contracts and pure domain types.
export {
  parseCustomerLogin,
  parseCustomerProfileUpdate,
  parseCustomerSignup,
} from "./contracts/customer.ts";
export * from "./domain/index.ts";
