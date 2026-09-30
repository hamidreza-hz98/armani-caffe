import "server-only";

import { adminTokenFromRequest, readCustomerCookie } from "../../modules/auth/server.ts";
import { renderInvoiceHtml } from "../../modules/invoices/index.ts";
import type { MongoInvoiceRepository } from "../../modules/invoices/server.ts";
import { ApplicationError, errorStatus } from "../../shared/errors.ts";
import { runSafeAction } from "../actions.ts";
import { readJsonBody } from "../http/json.ts";
import { requestIdFromHeader } from "../observability/index.ts";
import { getServerConfig } from "../secrets/config.ts";
import { receiptFontDataUrl } from "./invoice-font.ts";
import { configuredInvoiceRepository } from "./invoices.ts";
type Operation = "read" | "print" | "reprint";
export function createInvoiceHttpHandler(options: {
  invoices: () => Promise<MongoInvoiceRepository>;
  token: (request: Request, customer: boolean) => string | null;
  origins: () => readonly string[];
  font: () => Promise<string>;
}) {
  return async (
    request: Request,
    operation: Operation,
    orderId: string,
    customer = false,
  ): Promise<Response> => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      `invoice.${operation}`,
      async () => {
        const write = operation === "reprint";
        if (request.method !== (write ? "POST" : "GET") || new URL(request.url).search)
          throw new ApplicationError("VALIDATION", "Invalid invoice request");
        if (write && (customer || !options.origins().includes(request.headers.get("origin") ?? "")))
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        if (!/^[a-f\d]{24}$/u.test(orderId))
          throw new ApplicationError("VALIDATION", "Invalid order ID");
        const token = options.token(request, customer);
        if (!token) throw new ApplicationError("UNAUTHORIZED", "Session required");
        const invoices = await options.invoices();
        if (write) {
          const body = await readJsonBody(request, 1024);
          if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            Object.keys(body).some((key) => !["idempotencyKey", "paperWidthMm"].includes(key))
          )
            throw new ApplicationError("VALIDATION", "Invalid reprint command");
          const command = body as { idempotencyKey?: unknown; paperWidthMm?: unknown };
          if (
            typeof command.idempotencyKey !== "string" ||
            (command.paperWidthMm !== undefined &&
              command.paperWidthMm !== 58 &&
              command.paperWidthMm !== 80)
          )
            throw new ApplicationError("VALIDATION", "Invalid reprint command");
          return invoices.reprint(
            token,
            orderId,
            {
              idempotencyKey: command.idempotencyKey,
              paperWidthMm: command.paperWidthMm as 58 | 80 | undefined,
            },
            requestId,
          );
        }
        const invoice = await invoices.read(token, orderId, customer);
        if (operation === "read") return invoice;
        return renderInvoiceHtml(invoice, invoice.paperWidthMm, await options.font());
      },
      requestId,
    );
    const headers = {
      "Cache-Control": "private, no-store",
      "X-Request-ID": requestId,
      "X-Content-Type-Options": "nosniff",
    };
    if (result.ok && operation === "print")
      return new Response(result.value as string, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'",
        },
      });
    return Response.json(result, {
      status: result.ok ? 200 : errorStatus(result.error.code),
      headers,
    });
  };
}

export const handleInvoiceHttp = createInvoiceHttpHandler({
  invoices: configuredInvoiceRepository,
  token: (request, customer) =>
    customer
      ? readCustomerCookie(request, getServerConfig().mode === "production")
      : adminTokenFromRequest(request),
  origins: () => [
    new URL(getServerConfig().appUrl).origin,
    new URL(getServerConfig().adminUrl).origin,
  ],
  font: receiptFontDataUrl,
});
