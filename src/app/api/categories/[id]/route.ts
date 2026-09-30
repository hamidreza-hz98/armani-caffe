import { handleCategoryHttp } from "@/modules/catalog/categories/server";
import { invalidateMenuAfter } from "@/server/catalog/menu-cache";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleCategoryHttp(request, "detail", (await context.params).id);
}
export async function PATCH(request: Request, context: Context) {
  return invalidateMenuAfter(handleCategoryHttp(request, "update", (await context.params).id));
}
export async function DELETE(request: Request, context: Context) {
  return invalidateMenuAfter(handleCategoryHttp(request, "delete", (await context.params).id));
}
