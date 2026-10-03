import { paymentSettingsOperation } from "@/dashboard/payment/http";
import { runSafeAction } from "@/server/actions";
import { requestIdFromHeader } from "@/server/observability";
import { errorStatus } from "@/shared/errors";

export const runtime = "nodejs";
async function handle(request: Request, operation: "read" | "update") {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    `payment.settings.${operation}`,
    () => paymentSettingsOperation(request, operation, requestId),
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
export function GET(request: Request) {
  return handle(request, "read");
}
export function PATCH(request: Request) {
  return handle(request, "update");
}
