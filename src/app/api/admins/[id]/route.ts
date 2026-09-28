import { handleAdminsHttp } from "@/modules/auth/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handleAdminsHttp(request, "update", (await context.params).id);
}
export async function DELETE(request: Request, context: Context) {
  return handleAdminsHttp(request, "delete", (await context.params).id);
}
