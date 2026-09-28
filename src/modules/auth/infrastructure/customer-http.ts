import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { readJsonBody } from "../../../server/http/json.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import type { CustomerAuthService } from "../application/customer-auth.ts";
import { customerCookieName, validCustomerToken } from "../domain/customer-session.ts";

export type CustomerOperation = "signup" | "login" | "session" | "rotate" | "logout" | "profile";
export function readCustomerCookie(request: Request, production: boolean): string | null {
  const name = customerCookieName(production);
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  return validCustomerToken(token) ? token : null;
}
export function customerCookie(
  value: string,
  expiresAt: Date,
  production: boolean,
  now = new Date(),
) {
  return `${customerCookieName(production)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))}; Expires=${expiresAt.toUTCString()}${production ? "; Secure" : ""}`;
}
export function createCustomerHttpHandler(options: {
  service: () => Promise<CustomerAuthService>;
  production: () => boolean;
  origins: () => readonly string[];
  now?: () => Date;
}) {
  return async (request: Request, operation: CustomerOperation) => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    let cookie: string | null = null;
    const result = await runSafeAction(
      `customer.${operation}`,
      async () => {
        const method =
          operation === "session" || (operation === "profile" && request.method === "GET")
            ? "GET"
            : operation === "profile"
              ? "PATCH"
              : "POST";
        if (request.method !== method || new URL(request.url).search)
          throw new ApplicationError("VALIDATION", "Invalid customer request");
        const production = options.production();
        const token = readCustomerCookie(request, production);
        if (method !== "GET" && !options.origins().includes(request.headers.get("origin") ?? ""))
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        const body = method === "GET" ? null : await readJsonBody(request, 8 * 1024);
        if (
          !(
            ["signup", "login"].includes(operation) ||
            (operation === "profile" && method === "PATCH")
          ) &&
          method !== "GET" &&
          JSON.stringify(body) !== "{}"
        )
          throw new ApplicationError("VALIDATION", "Unexpected request body");
        if (
          (operation === "session" || operation === "profile" || operation === "rotate") &&
          !token
        )
          throw new ApplicationError("UNAUTHORIZED", "Customer session required");
        if (operation === "logout" && !token) {
          cookie = customerCookie("", new Date(0), production);
          return { loggedOut: true };
        }
        const service = await options.service();
        if (operation === "signup") return service.signup(body, requestId);
        if (operation === "session") {
          const principal = await service.resolve(token);
          if (!principal) throw new ApplicationError("UNAUTHORIZED", "Customer session required");
          return principal;
        }
        if (operation === "profile")
          return method === "GET" ? service.profile(token) : service.update(token, body, requestId);
        if (operation === "logout") {
          await service.logout(token, requestId);
          cookie = customerCookie("", new Date(0), production);
          return { loggedOut: true };
        }
        const issued =
          operation === "login"
            ? await service.login(body, token, requestId)
            : await service.rotate(token, requestId);
        cookie = customerCookie(
          issued.token,
          issued.expiresAt,
          production,
          options.now?.() ?? new Date(),
        );
        return issued.principal;
      },
      requestId,
    );
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": requestId,
    };
    if (result.ok && cookie) headers["Set-Cookie"] = cookie;
    if (!result.ok && result.error.code === "RATE_LIMITED") headers["Retry-After"] = "900";
    return Response.json(result, {
      status: result.ok ? 200 : errorStatus(result.error.code),
      headers,
    });
  };
}
