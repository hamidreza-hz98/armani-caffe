import { ApplicationError } from "../../../../shared/errors.ts";
export function assertProductTransition(from: string, to: string) {
  if (!(
    (from === "draft" && to === "published") ||
    (from === "published" && to === "draft") ||
    (["draft", "published"].includes(from) && to === "archived")
  ))
    throw new ApplicationError("CONFLICT", "Invalid product lifecycle transition");
}
export function validatePublished(product: {
  name: string;
  excerpt: string;
  basePriceToman: number;
  mediaIds: readonly unknown[];
}) {
  if (
    !product.name.trim() ||
    !product.excerpt.trim() ||
    product.basePriceToman <= 0 ||
    !product.mediaIds.length
  )
    throw new ApplicationError(
      "VALIDATION",
      "Published product needs name, excerpt, positive price and image",
    );
}
