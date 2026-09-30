import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import type { DashboardAnalyticsService } from "../application/service.ts";

export function createDashboardAnalyticsHttp(options: {
  service: () => Promise<DashboardAnalyticsService>;
  token: (request: Request) => string | null;
}) {
  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      "analytics.dashboard",
      async () => {
        if (request.method !== "GET" || new URL(request.url).search)
          throw new ApplicationError("VALIDATION", "Invalid dashboard request");
        const token = options.token(request);
        if (!token) throw new ApplicationError("UNAUTHORIZED", "Admin session required");
        return (await options.service()).read(token);
      },
      requestId,
    );
    return Response.json(result, {
      status: result.ok ? 200 : errorStatus(result.error.code),
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-ID": requestId,
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
