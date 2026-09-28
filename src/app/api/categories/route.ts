import { handleCategoryHttp } from "@/modules/catalog/categories/server";

export const runtime = "nodejs";
export function GET(request: Request) {
  return handleCategoryHttp(request, "list");
}
export function POST(request: Request) {
  return handleCategoryHttp(request, "create");
}
