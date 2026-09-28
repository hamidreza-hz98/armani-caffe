import { handleOrderHttp } from "@/server/commerce/order-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleOrderHttp(request, "checkout");
}
