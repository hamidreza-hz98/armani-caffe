import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import type { PaymentService } from "../application/service.ts";
import { paymentIdentifier } from "../domain/framework.ts";
export function createPaymentCallbackHandler(options: {
  service: () => Promise<PaymentService>;
  providerIds: () => readonly string[];
  callbackOrigin: () => string;
}) {
  return async (request: Request, provider: string, id: string) => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      "payment.callback",
      async () => {
        const url = new URL(request.url);
        if (!options.providerIds().includes(provider) || !/^[a-z][a-z0-9-]{0,59}$/u.test(provider))
          throw new ApplicationError("NOT_FOUND", "Unknown payment callback adapter");
        paymentIdentifier(id);
        if (
          url.origin !== options.callbackOrigin() ||
          url.pathname !== `/api/payments/callback/${provider}/${id}` ||
          !["GET", "POST"].includes(request.method) ||
          url.href.length > 4096
        )
          throw new ApplicationError("FORBIDDEN", "Unapproved payment callback URL");
        const fields: Record<string, string> = Object.create(null);
        for (const [key, value] of url.searchParams) {
          if (Object.hasOwn(fields, key) || key.length > 60 || value.length > 256)
            throw new ApplicationError("VALIDATION", "Invalid callback fields");
          fields[key] = value;
        }
        // Generic bounded form transport; each adapter still allowlists its documented methods/fields.
        if (request.method === "POST") {
          if (
            request.headers.get("content-type")?.split(";")[0] !==
            "application/x-www-form-urlencoded"
          )
            throw new ApplicationError("VALIDATION", "Unsupported payment callback encoding");
          const reader = request.body?.getReader();
          let text = "",
            size = 0;
          const decoder = new TextDecoder("utf-8", { fatal: true });
          try {
            if (reader)
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 4096) {
                  await reader.cancel();
                  throw new Error();
                }
                text += decoder.decode(chunk.value, { stream: true });
              }
            text += decoder.decode();
          } catch {
            throw new ApplicationError("VALIDATION", "Invalid payment callback body");
          } finally {
            reader?.releaseLock();
          }
          for (const [key, value] of new URLSearchParams(text)) {
            if (Object.hasOwn(fields, key) || key.length > 60 || value.length > 256)
              throw new ApplicationError("VALIDATION", "Invalid callback fields");
            fields[key] = value;
          }
        }
        if (!/^[a-f\d]{64}$/u.test(fields.state ?? ""))
          throw new ApplicationError("FORBIDDEN", "Missing payment callback state");
        return (await options.service()).callback(
          id,
          provider,
          request.method,
          url,
          fields,
          requestId,
        );
      },
      requestId,
    );
    return Response.json(result, {
      status: result.ok ? 200 : errorStatus(result.error.code),
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Request-ID": requestId,
      },
    });
  };
}
