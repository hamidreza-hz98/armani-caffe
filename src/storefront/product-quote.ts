import type { MenuProduct } from "@/modules/catalog/products";
import { ApplicationError } from "@/shared/errors";

export function productOptions(product: MenuProduct) {
  return {
    id: product.id,
    name: product.name,
    description: product.excerpt || product.ingredients,
    basePriceToman: product.basePriceToman,
    imageId: product.mediaIds[0] ?? null,
    orderable: product.orderable,
    additions: product.additions.map((addition) => ({
      id: addition.id,
      name: addition.name,
      priceToman: addition.priceToman,
      available: addition.available,
      imageId: addition.mediaId,
    })),
  };
}

export function quoteProduct(product: MenuProduct, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApplicationError("VALIDATION", "Invalid quote input");
  const row = input as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => !["additionIds", "quantity"].includes(key)) ||
    !Array.isArray(row.additionIds) ||
    row.additionIds.length > 20 ||
    row.additionIds.some((id) => typeof id !== "string" || !/^[a-f\d]{24}$/.test(id)) ||
    new Set(row.additionIds).size !== row.additionIds.length ||
    !Number.isSafeInteger(row.quantity) ||
    (row.quantity as number) < 1 ||
    (row.quantity as number) > 100
  )
    throw new ApplicationError("VALIDATION", "Invalid quote selection");
  if (!product.orderable) throw new ApplicationError("CONFLICT", "Product is unavailable");
  const additionIds = row.additionIds as string[];
  const selected = product.additions.filter((addition) => additionIds.includes(addition.id));
  if (selected.length !== additionIds.length || selected.some((addition) => !addition.available))
    throw new ApplicationError("CONFLICT", "Addition is unavailable");
  const unitPriceToman =
    product.basePriceToman + selected.reduce((total, addition) => total + addition.priceToman, 0);
  const totalToman = unitPriceToman * (row.quantity as number);
  if (!Number.isSafeInteger(unitPriceToman) || !Number.isSafeInteger(totalToman))
    throw new ApplicationError("VALIDATION", "Quote total exceeds integer range");
  return {
    productId: product.id,
    additionIds: selected.map((addition) => addition.id),
    quantity: row.quantity as number,
    unitPriceToman,
    totalToman,
  };
}
