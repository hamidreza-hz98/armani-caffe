export type Clock = () => Date;

export function utcNow(clock: Clock = () => new Date()): string {
  return clock().toISOString();
}

export function parseUtcTimestamp(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error("Timestamp must be canonical ISO-8601 UTC with milliseconds");
  }
  return date;
}
