export function securityHeaders(
  mode: "development" | "production" | "test",
  webSocketUrl?: string,
) {
  const development = mode === "development";
  const socketOrigin = webSocketUrl ? new URL(webSocketUrl).origin : null;
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${socketOrigin ? ` ${socketOrigin}` : ""}${development ? " ws: wss:" : ""}`,
    "frame-src 'none'",
    "worker-src 'self'",
  ];
  return [
    { key: "Content-Security-Policy", value: directives.join("; ") },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ...(mode === "production"
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
      : []),
  ];
}
