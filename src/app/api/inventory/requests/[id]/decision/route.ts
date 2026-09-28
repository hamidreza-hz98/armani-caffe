import { handleInventoryHttp } from "@/modules/inventory/server";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleInventoryHttp(request, "decide", (await context.params).id);
}
