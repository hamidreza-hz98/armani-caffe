import { handleMediaHttp } from "@/modules/media/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleMediaHttp(request, "detail", (await context.params).id);
}
export async function PATCH(request: Request, context: Context) {
  return handleMediaHttp(request, "update", (await context.params).id);
}
export async function DELETE(request: Request, context: Context) {
  return handleMediaHttp(request, "delete", (await context.params).id);
}
