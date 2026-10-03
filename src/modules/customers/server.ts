import "server-only";

// Server public boundary. Compose use cases and adapters here.
export {
  customerPhone,
  parseCustomerLogin,
  parseCustomerProfileUpdate,
  parseCustomerSignup,
} from "./contracts/customer.ts";
export { MongoCustomerRepository } from "./infrastructure/repository.ts";
export { customerSchema } from "./infrastructure/schema.ts";
