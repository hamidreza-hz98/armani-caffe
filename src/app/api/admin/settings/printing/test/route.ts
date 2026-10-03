import { authenticateAdminRequest } from "@/modules/auth/server";
import { browserTestPrintHtml, requestBrowserTestPrint } from "@/modules/settings/server";
import { runSafeAction } from "@/server/actions";
import { requestIdFromHeader } from "@/server/observability";
import { ApplicationError, errorStatus } from "@/shared/errors";

export const runtime = "nodejs";
async function owner(request: Request) {
  const actor = await authenticateAdminRequest(request);
  if (!actor) throw new ApplicationError("UNAUTHORIZED", "Sign in required");
  if (actor.role !== "OWNER") throw new ApplicationError("FORBIDDEN", "Owner only");
  return actor;
}
export async function POST(request: Request) {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    "settings.print-test",
    async () => {
      const actor = await owner(request);
      if (
        request.headers.get("content-type") !== "application/json" ||
        (await request.text()) !== "{}"
      )
        throw new ApplicationError("VALIDATION", "Empty JSON object required");
      return requestBrowserTestPrint(actor, request.headers.get("origin"), requestId);
    },
    requestId,
  );
  return Response.json(result, {
    status: result.ok ? 200 : errorStatus(result.error.code),
    headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
  });
}
export async function GET(request: Request) {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    "settings.print-test-view",
    async () => browserTestPrintHtml(await owner(request), new URL(request.url).searchParams),
    requestId,
  );
  if (!result.ok)
    return Response.json(result, {
      status: errorStatus(result.error.code),
      headers: { "Cache-Control": "no-store" },
    });
  return new Response(result.value, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}
