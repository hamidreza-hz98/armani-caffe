export type Addition = {
  id?: string;
  name: string;
  priceToman: number;
  available: boolean;
  mediaId: string | null;
};
export type Rule = { inventoryItemId: string; quantity: string | number; unit: string };
export type ProductFormFields = {
  name: string;
  categoryId: string;
  basePriceToman: number;
  description: string;
  excerpt: string;
  ingredients: string;
  mediaIds: string[];
  available: boolean;
  sortOrder: number;
  additions: Addition[];
  consumptionRules: Rule[];
};
export type UpdateProductField = <K extends keyof ProductFormFields>(
  key: K,
  value: ProductFormFields[K],
) => void;
