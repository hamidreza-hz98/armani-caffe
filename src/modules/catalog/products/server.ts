import "server-only";

// Server public boundary. Compose use cases and adapters here.
export { productCategoryDependencies } from "./infrastructure/category-references.ts";
export {
  productMediaIds,
  productMediaUsages,
  replaceProductMedia,
} from "./infrastructure/media-references.ts";
export { productAdditionSchema, productSchema } from "./infrastructure/schema.ts";
