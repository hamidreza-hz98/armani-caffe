import { handleMediaHttp } from "@/modules/media/server";
import { invalidateMenuAfter } from "@/server/catalog/menu-cache";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return invalidateMenuAfter(handleMediaHttp(request, "replace", (await context.params).id));
}
