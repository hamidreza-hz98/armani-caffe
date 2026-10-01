export type ProductSummary = Readonly<{
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  excerpt: string;
  basePriceToman: number;
  mediaIds: readonly string[];
  available: boolean;
  status: "draft" | "published" | "archived";
  revision: number;
  updatedAt: string;
}>;
export type ProductDetail = ProductSummary &
  Readonly<{
    description: string;
    ingredients: string;
    sortOrder: number;
    createdAt: string;
    deletedAt: string | null;
    soldCount: number;
    additions: {
      id: string;
      name: string;
      priceToman: number;
      available: boolean;
      mediaId: string | null;
      sortOrder: number;
    }[];
    consumptionRules: { inventoryItemId: string; quantity: string | number; unit: string }[];
  }>;
export type ProductListQuery = Readonly<{
  q: string;
  status: "all" | "draft" | "published" | "archived";
  categoryId: string;
  available: "all" | "yes" | "no";
  sort: "newest" | "name" | "price";
  page: number;
}>;
export type ProductPage = Readonly<{
  items: readonly ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
}>;

export function parseProductListQuery(raw: Record<string, string | undefined>): ProductListQuery {
  const q = (raw.q ?? "")
    .trim()
    .normalize("NFC")
    .slice(0, 80)
    .replace(/[<>\x00-\x1f]/gu, "");
  const status = ["draft", "published", "archived"].includes(raw.status ?? "")
    ? (raw.status as ProductListQuery["status"])
    : "all";
  const categoryId = /^[a-f0-9]{24}$/u.test(raw.category ?? "") ? raw.category! : "";
  const available = raw.available === "yes" || raw.available === "no" ? raw.available : "all";
  const sort = raw.sort === "name" || raw.sort === "price" ? raw.sort : "newest";
  const candidate = Number(raw.page);
  const page = Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= 25 ? candidate : 1;
  return { q, status, categoryId, available, sort, page };
}
