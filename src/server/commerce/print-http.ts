import "server-only";

import { adminTokenFromRequest, requireAdminToken } from "../../modules/auth/server.ts";
import { MongoPrintJobs } from "../../modules/printing/server.ts";
import { ApplicationError, errorStatus } from "../../shared/errors.ts";
import { runSafeAction } from "../actions.ts";
import { getDatabaseConnection } from "../database/connection.ts";
import { requestIdFromHeader } from "../observability/index.ts";

export async function handlePrintStatus(request: Request, orderId: string): Promise<Response> {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    "print.status",
    async () => {
      if (
        request.method !== "GET" ||
        new URL(request.url).search ||
        !/^[a-f\d]{24}$/u.test(orderId)
      )
        throw new ApplicationError("VALIDATION", "Invalid print status request");
      const token = adminTokenFromRequest(request);
      if (!token) throw new ApplicationError("UNAUTHORIZED", "Admin session required");
      await requireAdminToken(token, "printing.read");
      return new MongoPrintJobs(await getDatabaseConnection()).byOrder(orderId);
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
