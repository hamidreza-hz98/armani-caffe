import "server-only";

import { adminTokenFromRequest, readCustomerCookie } from "../../modules/auth/server.ts";
import { type MongoOrderRepository, type OrderService } from "../../modules/orders/server.ts";
import { ApplicationError, errorStatus } from "../../shared/errors.ts";
import { runSafeAction } from "../actions.ts";
import { getDatabaseConnection } from "../database/connection.ts";
import { readJsonBody } from "../http/json.ts";
import { requestIdFromHeader } from "../observability/index.ts";
import { getServerConfig } from "../secrets/config.ts";
import { composeOrderService } from "./orders.ts";
import { configuredPaymentFramework } from "./payments.ts";
type Operation =
  | "checkout"
  | "checkout-read"
  | "customer-list"
  | "customer-detail"
  | "list"
  | "detail"
  | "transition"
  | "refund"
  | "recoveries"
  | "recover"
  | "recovery-refund";
export function createOrderHttpHandler(options: {
  orders: () => Promise<{ service: OrderService; repository: MongoOrderRepository }>;
  payment: () => Promise<{
    create: (id: string, key: string, requestId: string) => Promise<unknown>;
  }>;
  token: (request: Request, customer: boolean) => string | null;
  origins: () => readonly string[];
}) {
  return async (request: Request, operation: Operation, id?: string) => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      `order.${operation}`,
      async () => {
        const write = ["checkout", "transition", "refund", "recover", "recovery-refund"].includes(
          operation,
        );
        if (request.method !== (write ? "POST" : "GET") || new URL(request.url).search)
          throw new ApplicationError("VALIDATION", "Invalid order request");
        if (write && !options.origins().includes(request.headers.get("origin") ?? ""))
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        const isCustomer = operation.startsWith("customer-") || operation.startsWith("checkout");
        const token = options.token(request, isCustomer);
        if (!token) throw new ApplicationError("UNAUTHORIZED", "Session required");
        if (id && !/^[a-f\d]{24}$/u.test(id))
          throw new ApplicationError("VALIDATION", "Invalid order identity");
        const { service, repository } = await options.orders();
        if (operation === "checkout") {
          const checkout = await service.checkout(
            token,
            await readJsonBody(request, 4096),
            requestId,
          );
          if (checkout.state !== "PAYMENT_PENDING") return { checkout, payment: null };
          return {
            checkout,
            payment: await (
              await options.payment()
            ).create(checkout.id, `checkout-${checkout.id}`, requestId),
          };
        }
        if (operation === "checkout-read") return service.checkoutView(token, id!);
        if (operation === "customer-list" || operation === "list")
          return service.list(token, isCustomer);
        if (operation === "customer-detail" || operation === "detail")
          return service.detail(token, id!, isCustomer);
        if (operation === "recoveries") return repository.recoveries(token);
        if (operation === "recover") {
          const body = await readJsonBody(request, 1024);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
            throw new ApplicationError("VALIDATION", "Empty recovery command required");
          return repository.retryRecovery(token, id!, requestId);
        }
        const input = await readJsonBody(request, 4096);
        return operation === "transition"
          ? service.transition(token, id!, input, requestId)
          : service.requestRefund(token, id!, input, requestId, operation === "recovery-refund");
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
export const handleOrderHttp = createOrderHttpHandler({
  orders: async () =>
    composeOrderService(await getDatabaseConnection(), {
      customerSessionSecret: getServerConfig().auth.sessionSecret,
      adminSessionSecret: getServerConfig().auth.adminSessionSecret,
    }),
  payment: configuredPaymentFramework,
  token: (request, customer) =>
    customer
      ? readCustomerCookie(request, getServerConfig().mode === "production")
      : adminTokenFromRequest(request),
  origins: () => [
    new URL(getServerConfig().appUrl).origin,
    new URL(getServerConfig().adminUrl).origin,
  ],
});
