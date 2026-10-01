import { handleProductOptions } from "@/server/catalog/product-options";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleProductOptions(request, (await context.params).id, "options");
}
export async function POST(request: Request, context: Context) {
  return handleProductOptions(request, (await context.params).id, "quote");
}
