import { orderDetailData } from "@/dashboard/orders/detail-server";
import { adminTokenFromRequest, authenticateAdminRequest } from "@/modules/auth/server";
import { runSafeAction } from "@/server/actions";
import { requestIdFromHeader } from "@/server/observability";
import { requireAdminCapability } from "@/shared/admin-capabilities";
import { ApplicationError, errorStatus } from "@/shared/errors";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    "orders.operational_detail",
    async () => {
      if (new URL(request.url).search) throw new ApplicationError("VALIDATION", "Unexpected query");
      requireAdminCapability(await authenticateAdminRequest(request), "orders.read");
      return orderDetailData(adminTokenFromRequest(request), (await context.params).id);
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
