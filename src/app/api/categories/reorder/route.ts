import { handleCategoryHttp } from "@/modules/catalog/categories/server";

export const runtime = "nodejs";
export function POST(request: Request) {
  return handleCategoryHttp(request, "reorder");
}
