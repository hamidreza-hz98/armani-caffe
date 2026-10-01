import type { PaymentView } from "@/modules/payments";
import { handlePaymentCallback, paymentResultBaseUrl } from "@/server/commerce/payments";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string; id: string }> },
) {
  const { provider, id } = await context.params;
  const response = await handlePaymentCallback(request, provider, id);
  // Preserve the JSON contract for gateway/API clients. A browser only receives a
  // location derived from a validated callback, never a status from query fields.
  if (!request.headers.get("accept")?.includes("text/html")) return response;
  const result = (await response.clone().json()) as
    { ok: true; value: PaymentView } | { ok: false };
  const path =
    result.ok && /^[a-f\d]{24}$/u.test(result.value.orderId)
      ? `/payment/result/${result.value.orderId}`
      : "/payment/result";
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(path, paymentResultBaseUrl()).href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
export const POST = GET;
