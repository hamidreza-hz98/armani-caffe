import { handlePaymentCallback } from "@/server/commerce/payments";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string; id: string }> },
) {
  const { provider, id } = await context.params;
  return handlePaymentCallback(request, provider, id);
}
export const POST = GET;
