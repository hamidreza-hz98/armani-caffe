import "server-only";
export { paymentReceipt } from "./infrastructure/repository.ts";

import type { Connection } from "mongoose";

import { ProviderRegistry } from "./application/provider.ts";
import { PaymentService } from "./application/service.ts";
import { MongoPaymentRepository, type PaymentPorts } from "./infrastructure/repository.ts";
export type {
  PaymentProvider,
  ProviderConfiguration,
  ProviderFactory,
  ProviderRequest,
  VerificationResult,
} from "./application/provider.ts";
export { ProviderRegistry } from "./application/provider.ts";
export { FakePaymentProvider, MemoryFakeLedger } from "./infrastructure/fake.ts";
export { MongoFakeLedger } from "./infrastructure/fake-ledger.ts";
export { createPaymentCallbackHandler } from "./infrastructure/http.ts";
export { IranianGatewayPlaceholder } from "./infrastructure/iranian-gateway.ts";
export type { PaymentPorts } from "./infrastructure/repository.ts";
export function createPaymentService(
  connection: Connection,
  ports: PaymentPorts,
  registry: ProviderRegistry,
  now: () => Date = () => new Date(),
  timeoutMs = 5000,
) {
  return new PaymentService(
    new MongoPaymentRepository(connection, ports, now),
    registry,
    timeoutMs,
  );
}

// Server public boundary. Compose use cases and adapters here.
export { transactionSchema } from "./infrastructure/schema.ts";
