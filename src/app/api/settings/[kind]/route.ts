import { handleSettingsHttp } from "@/modules/settings/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ kind: string }> };
export async function GET(request: Request, context: Context) {
  return handleSettingsHttp(request, "read", (await context.params).kind);
}
export async function PATCH(request: Request, context: Context) {
  return handleSettingsHttp(request, "update", (await context.params).kind);
}
