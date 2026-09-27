const secretKey =
  /password|secret|token|authorization|cookie|api.?key|access.?key|credential|encryption|uri|private.?key|email|phone|address/i;

export function redactText(value: string, secrets: readonly string[] = []): string {
  let result = value
    .replace(/(mongodb(?:\+srv)?|redis|rediss|https?):\/\/[^\s/@]+@/gi, "$1://[REDACTED]@")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/((?:password|secret|token|key)=)[^\s&]+/gi, "$1[REDACTED]");
  for (const secret of secrets) {
    if (secret.length >= 8) result = result.replaceAll(secret, "[REDACTED]");
  }
  return result;
}

export function redact(value: unknown, depth = 0, secrets: readonly string[] = []): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value, secrets);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message, secrets),
      stack: redactText(value.stack ?? "", secrets),
    };
  }
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => redact(item, depth + 1, secrets));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, item]) => [
          key,
          secretKey.test(key) ? "[REDACTED]" : redact(item, depth + 1, secrets),
        ]),
    );
  }
  return String(value);
}
