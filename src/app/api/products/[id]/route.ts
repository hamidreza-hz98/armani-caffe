import { invalidateMenuAfter } from "@/server/catalog/menu-cache";
import { handleProductHttp } from "@/server/catalog/products";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleProductHttp(request, "detail", (await context.params).id);
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return invalidateMenuAfter(handleProductHttp(request, "update", (await context.params).id));
}
