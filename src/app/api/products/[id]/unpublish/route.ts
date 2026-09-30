import { invalidateMenuAfter } from "@/server/catalog/menu-cache";
import { handleProductHttp } from "@/server/catalog/products";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return invalidateMenuAfter(handleProductHttp(request, "unpublish", (await context.params).id));
}
