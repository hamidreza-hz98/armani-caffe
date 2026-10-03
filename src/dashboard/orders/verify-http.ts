import "server-only";

import { adminTokenFromRequest, authenticateAdminRequest } from "@/modules/auth/server";
import { runSafeAction } from "@/server/actions";
import { configuredPaymentFramework } from "@/server/commerce/payments";
import { requestIdFromHeader } from "@/server/observability";
import { getServerConfig } from "@/server/secrets/config";
import { requireAdminCapability } from "@/shared/admin-capabilities";
import { ApplicationError, errorStatus } from "@/shared/errors";

import { orderDetailData } from "./detail-server";

export async function handleOrderVerification(request: Request, id: string) {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    "orders.payment_inquiry",
    async () => {
      if (request.method !== "POST" || new URL(request.url).search)
        throw new ApplicationError("VALIDATION", "Invalid inquiry request");
      const origin = request.headers.get("origin");
      const config = getServerConfig();
      if (![new URL(config.appUrl).origin, new URL(config.adminUrl).origin].includes(origin ?? ""))
        throw new ApplicationError("FORBIDDEN", "Invalid request origin");
      const actor = requireAdminCapability(
        await authenticateAdminRequest(request),
        "orders.manage",
      );
      if (actor.role !== "OWNER") throw new ApplicationError("FORBIDDEN", "Owner inquiry required");
      const detail = await orderDetailData(adminTokenFromRequest(request), id);
      if (detail.transaction?.status === "succeeded" || detail.transaction?.status === "refunded") {
        if (detail.transaction.amountToman !== detail.order.pricing.totalToman)
          throw new ApplicationError("CONFLICT", "Verified amount differs from order snapshot");
        return {
          status: detail.transaction.status,
          issue: detail.transaction.issue,
          source: "settled-record" as const,
        };
      }
      const transaction = await (
        await configuredPaymentFramework()
      ).inquire(detail.order.transaction.id, requestId);
      return {
        status: transaction.status,
        issue: transaction.issue,
        source: "provider-inquiry" as const,
      };
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
