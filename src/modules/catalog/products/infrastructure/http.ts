import "server-only";

import { runSafeAction } from "../../../../server/actions.ts";
import { readJsonBody } from "../../../../server/http/json.ts";
import { requestIdFromHeader } from "../../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../../shared/errors.ts";
import type { ProductService } from "../application/service.ts";
export type ProductOperation =
  "list" | "detail" | "menu" | "create" | "update" | "publish" | "unpublish" | "archive";
export function createProductHttpHandler(options: {
  service: () => Promise<ProductService>;
  token: (request: Request) => string | null;
  origins: () => readonly string[];
}) {
  return async (request: Request, operation: ProductOperation, id?: string) => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      "product." + operation,
      async () => {
        const method = ["list", "detail", "menu"].includes(operation)
          ? "GET"
          : operation === "update"
            ? "PATCH"
            : "POST";
        if (request.method !== method || new URL(request.url).search)
          throw new ApplicationError("VALIDATION", "Invalid product request");
        if (method !== "GET" && !options.origins().includes(request.headers.get("origin") ?? ""))
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        const token = options.token(request);
        if (operation !== "menu" && !token)
          throw new ApplicationError("UNAUTHORIZED", "Admin session required");
        const service = await options.service();
        if (operation === "menu") return service.menu();
        if (operation === "list") return service.list(token);
        if (operation === "detail") return service.detail(token, id);
        const body = await readJsonBody(request, 64 * 1024);
        if (operation === "create") return service.create(token, body, requestId);
        if (operation === "update") return service.update(token, id, body, requestId);
        return service.transition(
          token,
          id,
          body,
          operation === "publish" ? "published" : operation === "unpublish" ? "draft" : "archived",
          requestId,
        );
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
