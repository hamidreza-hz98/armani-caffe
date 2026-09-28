import { handleMediaHttp } from "@/modules/media/server";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleMediaHttp(request, "complete", (await context.params).id);
}
