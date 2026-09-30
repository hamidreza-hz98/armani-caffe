import { handleInvoiceHttp } from "@/server/commerce/invoice-http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleInvoiceHttp(request, "reprint", (await context.params).id);
}
