import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { readJsonBody } from "../../../server/http/json.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import type { CartService } from "../application/service.ts";
export function createCartHttpHandler(options: {
  service: () => Promise<CartService>;
  token: (request: Request) => string | null;
  origins: () => readonly string[];
}) {
  return async (request: Request, operation: "read" | "mutate" | "preview") => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      "cart." + operation,
      async () => {
        if (
          request.method !== (operation === "read" ? "GET" : "POST") ||
          new URL(request.url).search
        )
          throw new ApplicationError("VALIDATION", "Invalid cart request");
        if (
          operation !== "read" &&
          !options.origins().includes(request.headers.get("origin") ?? "")
        )
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        const token = options.token(request);
        if (!token) throw new ApplicationError("UNAUTHORIZED", "Customer session required");
        const service = await options.service();
        if (operation === "read") return service.read(token);
        const body = await readJsonBody(request, 16 * 1024);
        return operation === "preview" ? service.preview(token, body) : service.mutate(token, body);
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
  };
}
