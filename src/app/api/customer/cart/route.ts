import { handleCartHttp } from "@/server/commerce/carts";
export const runtime = "nodejs";
export const GET = (request: Request) => handleCartHttp(request, "read");
export const POST = (request: Request) => handleCartHttp(request, "mutate");
