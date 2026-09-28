import { handleOrderHttp } from "@/server/commerce/order-http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleOrderHttp(request, "recover", (await context.params).id);
}
