import { handleMediaHttp } from "@/modules/media/server";

export const runtime = "nodejs";
export function POST(request: Request) {
  return handleMediaHttp(request, "completeBulk");
}
