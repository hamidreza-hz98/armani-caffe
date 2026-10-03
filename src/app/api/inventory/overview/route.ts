import { inventorySnapshot } from "@/dashboard/inventory/server";
import { adminTokenFromRequest } from "@/modules/auth/server";
import { runSafeAction } from "@/server/actions";
import { requestIdFromHeader } from "@/server/observability";
import { ApplicationError, errorStatus } from "@/shared/errors";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    "inventory.overview",
    async () => {
      if (new URL(request.url).search) throw new ApplicationError("VALIDATION", "Unexpected query");
      return inventorySnapshot(adminTokenFromRequest(request));
    },
    requestId,
  );
  return Response.json(result, {
    status: result.ok ? 200 : errorStatus(result.error.code),
    headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
  });
}
