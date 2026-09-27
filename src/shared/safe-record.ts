const sensitiveKey =
  /password|secret|token|credential|key|phone|email|address|cookie|authorization/i;

export function assertSafeRecord(value: Readonly<Record<string, unknown>>, maxFields = 30): void {
  const entries = Object.entries(value);
  if (entries.length > maxFields) throw new RangeError("Too many metadata fields");
  for (const [key, item] of entries) {
    if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) || sensitiveKey.test(key))
      throw new RangeError("Unsafe metadata key");
    if (
      item !== null &&
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    )
      throw new RangeError("Metadata values must be primitive");
    if (typeof item === "string" && item.length > 500)
      throw new RangeError("Metadata value too long");
    if (typeof item === "number" && !Number.isFinite(item))
      throw new RangeError("Metadata number must be finite");
  }
}
