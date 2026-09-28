import { handleInventoryHttp } from "@/modules/inventory/server";
export const runtime = "nodejs";
export function GET(request: Request) {
  return handleInventoryHttp(request, "requests");
}
export function POST(request: Request) {
  return handleInventoryHttp(request, "request");
}
