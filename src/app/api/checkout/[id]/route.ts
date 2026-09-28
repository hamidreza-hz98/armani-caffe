import { handleOrderHttp } from "@/server/commerce/order-http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleOrderHttp(request, "checkout-read", (await context.params).id);
}
