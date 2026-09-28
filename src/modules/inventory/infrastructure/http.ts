import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { readJsonBody } from "../../../server/http/json.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import type { InventoryService } from "../application/service.ts";
export type InventoryOperation =
  "list" | "create" | "update" | "movements" | "requests" | "request" | "decide";
export function createInventoryHttpHandler(options: {
  service: () => Promise<InventoryService>;
  token: (request: Request) => string | null;
  origins: () => readonly string[];
}) {
  return async (request: Request, operation: InventoryOperation, id?: string) => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      `inventory.${operation}`,
      async () => {
        const method = {
          list: "GET",
          create: "POST",
          update: "PATCH",
          movements: "GET",
          requests: "GET",
          request: "POST",
          decide: "POST",
        }[operation];
        if (request.method !== method || new URL(request.url).search)
          throw new ApplicationError("VALIDATION", "Invalid inventory request");
        if (method !== "GET" && !options.origins().includes(request.headers.get("origin") ?? ""))
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        const token = options.token(request);
        if (!token) throw new ApplicationError("UNAUTHORIZED", "Admin session required");
        const service = await options.service();
        if (operation === "list") return service.list(token);
        if (operation === "requests") return service.requests(token);
        if (operation === "movements") return service.movements(token, id);
        const body = await readJsonBody(request, 16 * 1024);
        if (operation === "create") return service.create(token, body, requestId);
        if (operation === "update") return service.update(token, id, body, requestId);
        if (operation === "request") return service.request(token, body, requestId);
        return service.decide(token, id, body, requestId);
      },
      requestId,
    );
    return Response.json(result, {
      status: result.ok ? 200 : errorStatus(result.error.code),
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-ID": requestId,
      },
    });
  };
}
