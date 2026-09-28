const formatter = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function canonicalBirthDate(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input))
    throw new RangeError("Birth date must be a Gregorian YYYY-MM-DD date");
  const date = new Date(`${input}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input)
    throw new RangeError("Invalid birth date");
  return input;
}

export function gregorianToJalali(input: string): string {
  canonicalBirthDate(input);
  const parts = formatter.formatToParts(new Date(`${input}T00:00:00.000Z`));
  const value = (kind: "year" | "month" | "day") =>
    parts.find((part) => part.type === kind)?.value.padStart(kind === "year" ? 4 : 2, "0");
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** UI-boundary adapter; persistence always receives a Gregorian UTC calendar date. */
export function jalaliToGregorian(input: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new RangeError("Invalid Jalali date");
  const target = Number(input.replaceAll("-", ""));
  if (target < 12000101 || target > 15991230) throw new RangeError("Jalali date out of range");
  let low = Date.UTC(1821, 0, 1) / 86400000;
  let high = Date.UTC(2222, 11, 31) / 86400000;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const gregorian = new Date(middle * 86400000).toISOString().slice(0, 10);
    const current = Number(gregorianToJalali(gregorian).replaceAll("-", ""));
    if (current === target) return gregorian;
    if (current < target) low = middle + 1;
    else high = middle - 1;
  }
  throw new RangeError("Invalid Jalali date");
}
