import "server-only";

import type { Connection } from "mongoose";

import type { AdminAuthorizer } from "../../../shared/security-ports.ts";
import { ProductService } from "./application/service.ts";
import { MongoProductRepository, type ProductPorts } from "./infrastructure/repository.ts";
export { ProductService } from "./application/service.ts";
export { createProductHttpHandler } from "./infrastructure/http.ts";
export type { ProductPorts } from "./infrastructure/repository.ts";
export function createProductService(
  connection: Connection,
  authorize: AdminAuthorizer,
  ports: ProductPorts,
  now: () => Date = () => new Date(),
) {
  return new ProductService(new MongoProductRepository(connection, authorize, ports, now));
}

// Server public boundary. Compose use cases and adapters here.
export { productCategoryDependencies } from "./infrastructure/category-references.ts";
export {
  productMediaIds,
  productMediaUsages,
  replaceProductMedia,
} from "./infrastructure/media-references.ts";
export { productAdditionSchema, productSchema } from "./infrastructure/schema.ts";
