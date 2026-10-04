import { describe, expect, it } from "vitest";

import { securityHeaders } from "@/config/security-headers";
import { redact } from "@/server/observability/redact";
import { ApplicationError, errorStatus, serializeError } from "@/shared/errors";
import { parseListQuery } from "@/shared/query";

describe("shared application foundations", () => {
  it("serializes application and unexpected errors without leaking private messages", () => {
    expect(
      serializeError(new ApplicationError("NOT_FOUND", "private database key"), "request-1"),
    ).toEqual({ code: "NOT_FOUND", message: "مورد درخواستی پیدا نشد.", requestId: "request-1" });
    expect(serializeError(new Error("secret"), "request-2").message).not.toContain("secret");
    expect(errorStatus("UNAVAILABLE")).toBe(503);
  });

  it("redacts nested sensitive fields and configured secrets", () => {
    const output = redact(
      {
        token: "abc",
        nested: { phone: "123", message: "value-private" },
        endpoint: "redis://user:pass@host:6379",
      },
      0,
      ["value-private"],
    );
    expect(output).toEqual({
      token: "[REDACTED]",
      nested: { phone: "[REDACTED]", message: "[REDACTED]" },
      endpoint: "redis://[REDACTED]@host:6379",
    });
  });

  it("accepts only bounded, allowlisted pagination and filters", () => {
    const options = {
      sorts: ["createdAt", "price"] as const,
      defaultSort: "createdAt" as const,
      filters: ["status"] as const,
    };
    const query = parseListQuery(
      new URLSearchParams("page=2&pageSize=25&sort=price&direction=asc&status=active"),
      options,
    );
    expect(query).toEqual({
      pagination: { page: 2, pageSize: 25, skip: 25 },
      sort: "price",
      direction: "asc",
      filters: { status: "active" },
    });
    expect(() => parseListQuery(new URLSearchParams("sort=secret"), options)).toThrow(
      ApplicationError,
    );
    expect(() => parseListQuery(new URLSearchParams("page=1&page=2"), options)).toThrow(
      ApplicationError,
    );
  });

  it("sets a production CSP and only permits dev eval in development", () => {
    const production = securityHeaders("production");
    const csp = production.find((header) => header.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(production).toContainEqual({
      key: "Strict-Transport-Security",
      value: "max-age=31536000",
    });
    expect(production).toContainEqual({
      key: "Cross-Origin-Resource-Policy",
      value: "same-origin",
    });
    expect(
      securityHeaders("development").some((header) => header.key === "Strict-Transport-Security"),
    ).toBe(false);
    expect(securityHeaders("production", "wss://socket.example/ws")[0].value).toContain(
      "connect-src 'self' wss://socket.example",
    );
    expect(securityHeaders("development")[0].value).toContain("unsafe-eval");
  });
});
