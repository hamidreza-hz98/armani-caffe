import { handleCategoryHttp } from "@/modules/catalog/categories/server";
import { invalidateMenuAfter } from "@/server/catalog/menu-cache";

export const runtime = "nodejs";
export function GET(request: Request) {
  return handleCategoryHttp(request, "list");
}
export function POST(request: Request) {
  return invalidateMenuAfter(handleCategoryHttp(request, "create"));
}
