import { handleInventoryHttp } from "@/modules/inventory/server";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleInventoryHttp(request, "update", (await context.params).id);
}
