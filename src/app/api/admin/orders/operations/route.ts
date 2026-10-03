import { parseOrderFilters } from "@/dashboard/orders/model";
import { listOperationalOrders } from "@/dashboard/orders/server";
import { authenticateAdminRequest } from "@/modules/auth/server";
import { runSafeAction } from "@/server/actions";
import { requestIdFromHeader } from "@/server/observability";
import { requireAdminCapability } from "@/shared/admin-capabilities";
import { ApplicationError, errorStatus } from "@/shared/errors";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    "orders.operations",
    async () => {
      requireAdminCapability(await authenticateAdminRequest(request), "orders.read");
      const params = new URL(request.url).searchParams;
      if (
        [...params.keys()].some(
          (key) =>
            !["q", "status", "payment", "range", "sort", "page"].includes(key) ||
            params.getAll(key).length !== 1,
        )
      )
        throw new ApplicationError("VALIDATION", "Invalid order filters");
      return listOperationalOrders(parseOrderFilters(Object.fromEntries(params)));
    },
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
