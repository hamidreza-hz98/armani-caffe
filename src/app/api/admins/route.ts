import { handleAdminsHttp } from "@/modules/auth/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleAdminsHttp(request, "list");
}
export async function POST(request: Request) {
  return handleAdminsHttp(request, "create");
}
