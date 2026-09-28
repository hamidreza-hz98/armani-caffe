import { handleMediaHttp } from "@/modules/media/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return handleMediaHttp(request, "list");
}
export function POST(request: Request) {
  return handleMediaHttp(request, "initiate");
}
