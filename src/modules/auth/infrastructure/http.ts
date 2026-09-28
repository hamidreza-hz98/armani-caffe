import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import { readJsonBody } from "../../../server/http/json.ts";
import { requestIdFromHeader } from "../../../server/observability/index.ts";
import { ApplicationError, errorStatus } from "../../../shared/errors.ts";
import type { AdminAuthService } from "../application/admin-auth.ts";
import { authRecord, parseAdminLogin } from "../contracts/admin-auth.ts";
import { adminCookieName, validAdminToken } from "../domain/admin-session.ts";

export function readAdminCookie(request: Request, production: boolean): string | null {
  const name = adminCookieName(production),
    matches = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return validAdminToken(value) ? value : null;
}
export function adminCookie(
  value: string,
  expiresAt: Date,
  production: boolean,
  now = new Date(),
): string {
  return `${adminCookieName(production)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))}; Expires=${expiresAt.toUTCString()}${production ? "; Secure" : ""}`;
}
export function createAdminAuthHttpHandler(options: {
  service: () => Promise<AdminAuthService>;
  production: () => boolean;
  origins: () => readonly string[];
  network: (request: Request) => string;
  now?: () => Date;
}) {
  return async (request: Request, operation: "login" | "session" | "logout" | "rotate") => {
    const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
    let cookie: string | null = null;
    const result = await runSafeAction(
      `admin.${operation}`,
      async () => {
        if (
          request.method !== (operation === "session" ? "GET" : "POST") ||
          new URL(request.url).search
        )
          throw new ApplicationError("VALIDATION", "Invalid auth request");
        const production = options.production(),
          token = readAdminCookie(request, production);
        if (
          operation !== "session" &&
          !options.origins().includes(request.headers.get("origin") ?? "")
        )
          throw new ApplicationError("FORBIDDEN", "Invalid request origin");
        if (operation === "session" && !token)
          throw new ApplicationError("UNAUTHORIZED", "Valid session required");
        const body = operation === "session" ? {} : await readJsonBody(request, 8 * 1024);
        if (operation !== "login") authRecord(body, []);
        if (operation === "login") parseAdminLogin(body);
        if (operation === "rotate" && !token)
          throw new ApplicationError("UNAUTHORIZED", "Valid session required");
        if (operation === "logout" && !token) {
          cookie = adminCookie("", new Date(0), production);
          return { loggedOut: true };
        }
        const service = await options.service();
        if (operation === "session") {
          const actor = await service.resolve(token);
          if (!actor) throw new ApplicationError("UNAUTHORIZED", "Valid session required");
          return actor;
        }
        if (operation === "logout") {
          await service.logout(token, requestId);
          cookie = adminCookie("", new Date(0), production);
          return { loggedOut: true };
        }
        const issued =
          operation === "login"
            ? await service.login(body, token, options.network(request), requestId)
            : await service.rotate(token, requestId);
        cookie = adminCookie(
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
