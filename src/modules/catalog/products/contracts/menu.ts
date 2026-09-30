/** Public catalog projection. Persistence records and stock/cost rules never cross this boundary. */
export type MenuAddition = Readonly<{
  id: string;
  name: string;
  priceToman: number;
  available: boolean;
  mediaId: string | null;
  sortOrder: number;
}>;
export type MenuProduct = Readonly<{
  id: string;
  name: string;
  slug: string;
  excerpt: string;
  ingredients: string;
  basePriceToman: number;
  mediaIds: readonly string[];
  orderable: boolean;
  soldCount: number;
  additions: readonly MenuAddition[];
}>;
export type MenuCategory = Readonly<{
  id: string;
  name: string;
  sortOrder: number;
  products: readonly MenuProduct[];
}>;
