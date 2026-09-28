import { handleOrderHttp } from "@/server/commerce/order-http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleOrderHttp(request, "list");
}
