export type ProductOptionSet = {
  id: string;
  basePriceToman: number;
  additions: { id: string; priceToman: number; available: boolean }[];
};

export function quoteSelectedOptions(
  options: ProductOptionSet,
  additionIds: string[],
  quantity: number,
) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 100 ||
    additionIds.length > 20 ||
    new Set(additionIds).size !== additionIds.length
  )
    return null;
  const additions = additionIds.map((id) =>
    options.additions.find((addition) => addition.id === id),
  );
  if (additions.some((addition) => !addition?.available)) return null;
  const unitPriceToman =
    options.basePriceToman +
    additions.reduce((total, addition) => total + (addition?.priceToman ?? 0), 0);
  const totalToman = unitPriceToman * quantity;
  if (!Number.isSafeInteger(unitPriceToman) || !Number.isSafeInteger(totalToman)) return null;
  return { productId: options.id, additionIds, quantity, unitPriceToman, totalToman };
}
