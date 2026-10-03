import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { readJsonBody } from "../../../server/http/json.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { type AdminActor, requireAdminCapability } from "../../../shared/admin-capabilities.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import type { AdminService } from "../application/service.ts";

export function createAdminsHttpHandler(options: {
  service: () => Promise<AdminService>;
  authenticate: (request: Request) => Promise<AdminActor | null>;
  token: (request: Request) => string | null;
  origins: () => readonly string[];
}) {
  return async (
    request: Request,
    operation: "list" | "create" | "update" | "delete" | "reset",
    id?: string,
  ) => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      `admins.${operation}`,
      async () => {
        requireAdminCapability(
          await options.authenticate(request),
          operation === "list" ? "admins.read" : "admins.manage",
        );
        if (
          request.method !==
          (
            {
              list: "GET",
              create: "POST",
              update: "PATCH",
              delete: "DELETE",
              reset: "POST",
            } as const
          )[operation]
        )
          throw new ApplicationError("VALIDATION", "Unexpected method");
        const url = new URL(request.url);
        const mutation = operation !== "list";
        if (
          mutation &&
          (!options.origins().includes(request.headers.get("origin") ?? "") || url.search)
        )
          throw new ApplicationError("FORBIDDEN", "Invalid mutation origin or query");
        const input = mutation ? await readJsonBody(request) : {};
        const service = await options.service(),
          token = options.token(request);
        if (operation === "list") {
          if (
            [...url.searchParams.keys()].some(
              (key) => !["page", "limit", "q", "role", "status"].includes(key),
            ) ||
            [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length > 1)
          )
            throw new ApplicationError("VALIDATION", "Invalid admin list query");
          return service.list(
            token,
            Number(url.searchParams.get("page") ?? 1),
            Number(url.searchParams.get("limit") ?? 20),
            {
              ...(url.searchParams.has("q") ? { q: url.searchParams.get("q")! } : {}),
              ...(url.searchParams.has("role")
                ? { role: url.searchParams.get("role") as "OWNER" | "CASHIER" }
                : {}),
              ...(url.searchParams.has("status")
                ? { status: url.searchParams.get("status") as "active" | "disabled" }
                : {}),
            },
          );
        }
        if (operation === "create") return service.create(token, input, requestId);
        if (operation === "update") return service.update(token, id, input, requestId);
        if (operation === "reset") {
          await service.resetPassword(token, id, input, requestId);
          return { reset: true };
        }
        await service.delete(token, id, input, requestId);
        return { deleted: true };
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
