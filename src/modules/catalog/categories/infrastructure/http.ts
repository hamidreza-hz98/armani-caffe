import "server-only";

import { runSafeAction } from "../../../../server/actions.ts";
import { readJsonBody } from "../../../../server/http/json.ts";
import { requestIdFromHeader } from "../../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../../shared/errors.ts";
import type { CategoryService } from "../application/service.ts";

export type CategoryOperation =
  "public" | "list" | "detail" | "create" | "update" | "delete" | "reorder";
export function createCategoryHttpHandler(options: {
  service: () => Promise<CategoryService>;
  token: (request: Request) => string | null;
  origins: () => readonly string[];
}) {
  return async (request: Request, operation: CategoryOperation, id?: string) => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      `category.${operation}`,
      async () => {
        const method = (
          {
            public: "GET",
            list: "GET",
            detail: "GET",
            create: "POST",
            update: "PATCH",
            delete: "DELETE",
            reorder: "POST",
          } as const
        )[operation];
        if (request.method !== method || new URL(request.url).search)
          throw new ApplicationError("VALIDATION", "Invalid category request");
        if (method !== "GET") {
          const origin = request.headers.get("origin") ?? "";
          const requestOrigin = new URL(request.url).origin;
          if (origin !== requestOrigin && !options.origins().includes(origin))
            throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        }
        const token = options.token(request);
        if (operation !== "public" && !token)
          throw new ApplicationError("UNAUTHORIZED", "Admin session required");
        const service = await options.service();
        if (operation === "public") return service.publicList();
        if (operation === "list") return service.adminList(token);
        if (operation === "detail") return service.detail(token, id);
        const body = await readJsonBody(request, 16 * 1024);
        if (operation === "create") return service.create(token, body, requestId);
        if (operation === "update") return service.update(token, id, body, requestId);
        if (operation === "reorder") return service.reorder(token, body, requestId);
        await service.delete(token, id, body, requestId);
        return { deleted: true };
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
