import { handleMediaHttp } from "@/modules/media/server";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleMediaHttp(request, "usages", (await context.params).id);
}
