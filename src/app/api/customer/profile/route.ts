import { handleCustomerHttp } from "@/modules/auth/server";

export const runtime = "nodejs";
export function GET(request: Request) {
  return handleCustomerHttp(request, "profile");
}
export function PATCH(request: Request) {
  return handleCustomerHttp(request, "profile");
}
