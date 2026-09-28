import { handleProductHttp } from "@/server/catalog/products";
export const runtime = "nodejs";
export function GET(request: Request) {
  return handleProductHttp(request, "list");
}
export function POST(request: Request) {
  return handleProductHttp(request, "create");
}
