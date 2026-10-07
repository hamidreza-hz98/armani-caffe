import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { readJsonBody } from "../../../server/http/json.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { getServerConfig } from "../../../server/secrets/config.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import { normalizeIranianMobile } from "../../../shared/phone.ts";
import type { SmsPurpose } from "../contracts/index.ts";

export function createOtpHttpHandler(options: {
  origin: () => string;
  preview: () => boolean;
  send: (
    phone: string,
    purpose: SmsPurpose,
  ) => Promise<{ expiresInSeconds: number; resendInSeconds: number }>;
}) {
  return async (request: Request) => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    const result = await runSafeAction(
      "customer.otp.send",
      async () => {
        if (
          request.method !== "POST" ||
          new URL(request.url).search ||
          request.headers.get("origin") !== options.origin()
        )
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        const body = (await readJsonBody(request, 1024)) as Record<string, unknown>;
        if (
          !body ||
          Object.keys(body).some((key) => !["phone", "purpose"].includes(key)) ||
          !["login", "signup"].includes(String(body.purpose)) ||
          typeof body.phone !== "string" ||
          body.phone.length > 64
        )
          throw new ApplicationError("VALIDATION", "Invalid OTP request");
        if (options.preview()) return { preview: true, resendInSeconds: 0 };
        let phone: string;
        try {
          phone = normalizeIranianMobile(body.phone);
        } catch {
          throw new ApplicationError("VALIDATION", "Invalid mobile number");
        }
        const purpose = body.purpose === "login" ? "customer-login" : "customer-signup";
        return { preview: false, ...(await options.send(phone, purpose)) };
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

export function createOtpStatusHandler(preview: () => boolean) {
  return async () =>
    Response.json({ preview: preview() }, { headers: { "Cache-Control": "no-store" } });
}

export const customerOtpOrigin = () => new URL(getServerConfig().appUrl).origin;
