import { handlePrintStatus } from "@/server/commerce/print-http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handlePrintStatus(request, (await context.params).id);
}
