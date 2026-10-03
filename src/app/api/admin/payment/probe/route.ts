import { paymentSettingsOperation } from "@/dashboard/payment/http";
import { runSafeAction } from "@/server/actions";
import { requestIdFromHeader } from "@/server/observability";
import { errorStatus } from "@/shared/errors";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    "payment.settings.probe",
    () => paymentSettingsOperation(request, "probe", requestId),
    requestId,
  );
  return Response.json(result, {
    status: result.ok ? 200 : errorStatus(result.error.code),
    headers: {
      "Cache-Control": "no-store",
      "X-Request-ID": requestId,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
