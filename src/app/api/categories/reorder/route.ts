import { handleCategoryHttp } from "@/modules/catalog/categories/server";
import { invalidateMenuAfter } from "@/server/catalog/menu-cache";

export const runtime = "nodejs";
export function POST(request: Request) {
  return invalidateMenuAfter(handleCategoryHttp(request, "reorder"));
}
