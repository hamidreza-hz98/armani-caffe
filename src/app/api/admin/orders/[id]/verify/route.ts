import { handleOrderVerification } from "@/dashboard/orders/verify-http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleOrderVerification(request, (await context.params).id);
}
