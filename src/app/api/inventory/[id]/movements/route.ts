import { handleInventoryHttp } from "@/modules/inventory/server";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleInventoryHttp(request, "movements", (await context.params).id);
}
