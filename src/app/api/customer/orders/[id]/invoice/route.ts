import { handleInvoiceHttp } from "@/server/commerce/invoice-http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleInvoiceHttp(request, "read", (await context.params).id, true);
}
