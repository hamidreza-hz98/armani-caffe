import { handleSettingsHttp } from "@/modules/settings/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleSettingsHttp(request, "public");
}
