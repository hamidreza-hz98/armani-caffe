import "server-only";

import type { Connection } from "mongoose";

import type { CartPorts } from "./application/service.ts";
import { CartService } from "./application/service.ts";
import { MongoCartRepository } from "./infrastructure/repository.ts";
export type { CartPorts, CartView } from "./application/service.ts";
export { createCartHttpHandler } from "./infrastructure/http.ts";
export function createCartService(
  connection: Connection,
  ports: CartPorts,
  now: () => Date = () => new Date(),
) {
  return new CartService(new MongoCartRepository(connection, ports, now));
}

// Server public boundary. Compose use cases and adapters here.
export { cartSchema } from "./infrastructure/schema.ts";
