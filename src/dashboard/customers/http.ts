import "server-only";

import { adminTokenFromRequest, authenticateAdminRequest } from "@/modules/auth/server";
import { runSafeAction } from "@/server/actions";
import { readJsonBody } from "@/server/http/json";
import { requestIdFromHeader } from "@/server/observability";
import { getServerConfig } from "@/server/secrets/config";
import { requireAdminCapability } from "@/shared/admin-capabilities";
import { ApplicationError, errorStatus } from "@/shared/errors";

import {
  anonymizeCustomer,
  createCustomer,
  customerDetail,
  listCustomers,
  parseCustomerFilters,
  updateCustomer,
} from "./server";

export async function handleCustomerManagement(
  request: Request,
  operation: "list" | "create" | "detail" | "update" | "anonymize",
  id?: string,
) {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    `customers.${operation}`,
    async () => {
      const actor = await authenticateAdminRequest(request);
      requireAdminCapability(
        actor,
        operation === "list" || operation === "detail" ? "customers.read" : "customers.manage",
      );
      const expected = {
        list: "GET",
        create: "POST",
        detail: "GET",
        update: "PATCH",
        anonymize: "DELETE",
      }[operation];
      if (request.method !== expected) throw new ApplicationError("VALIDATION", "Invalid method");
      const url = new URL(request.url);
      if (operation === "list") {
        if (
          [...url.searchParams.keys()].some(
            (key) =>
              !["q", "status", "page"].includes(key) || url.searchParams.getAll(key).length !== 1,
          )
        )
          throw new ApplicationError("VALIDATION", "Invalid list query");
        return listCustomers(parseCustomerFilters(Object.fromEntries(url.searchParams)));
      }
      if (url.search) throw new ApplicationError("VALIDATION", "Unexpected query");
      if (operation === "detail") return customerDetail(id ?? "");
      const config = getServerConfig();
      if (
        ![new URL(config.appUrl).origin, new URL(config.adminUrl).origin].includes(
          request.headers.get("origin") ?? "",
        )
      )
        throw new ApplicationError("FORBIDDEN", "Invalid mutation origin");
      const input = await readJsonBody(request);
      const token = adminTokenFromRequest(request);
      if (operation === "create") return createCustomer(token, input, requestId);
      if (operation === "update") return updateCustomer(token, id ?? "", input, requestId);
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => key !== "revision")
      )
        throw new ApplicationError("VALIDATION", "Invalid deletion input");
      return anonymizeCustomer(
        token,
        id ?? "",
        (input as { revision: number }).revision,
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
}
