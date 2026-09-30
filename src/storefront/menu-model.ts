import type { MenuCategory } from "@/modules/catalog/products";

export type MenuCardCategory = Readonly<{
  id: string;
  name: string;
  products: readonly {
    id: string;
    name: string;
    description: string;
    priceToman: number;
    imageId: string | null;
    orderable: boolean;
    hasAdditions: boolean;
  }[];
}>;

/** Keep the HTML/client-boundary payload lean; additions are fetched by a later options flow. */
export function menuCards(categories: readonly MenuCategory[]): MenuCardCategory[] {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    products: category.products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.excerpt || product.ingredients,
      priceToman: product.basePriceToman,
      imageId: product.mediaIds[0] ?? null,
      orderable: product.orderable,
      hasAdditions: product.additions.length > 0,
    })),
  }));
}

export const categoryAnchor = (id: string) => `category-${id}`;
