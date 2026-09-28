import { handleAdminsHttp } from "@/modules/auth/server";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleAdminsHttp(request, "reset", (await context.params).id);
}
