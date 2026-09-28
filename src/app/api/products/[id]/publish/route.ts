import { handleProductHttp } from "@/server/catalog/products";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleProductHttp(request, "publish", (await context.params).id);
}
