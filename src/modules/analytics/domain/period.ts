const tehranDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayKey = (date: Date) => {
  const parts = tehranDay.formatToParts(date);
  const part = (type: "year" | "month" | "day") =>
    Number(parts.find((item) => item.type === type)?.value);
  return `${part("year")}-${String(part("month")).padStart(2, "0")}-${String(part("day")).padStart(2, "0")}`;
};
/** Locate local midnight as a UTC instant, including historical Tehran offset changes. */
function startOfTehranDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const noon = Date.UTC(year!, month! - 1, date!, 0);
  let low = noon - 24 * 60 * 60 * 1000;
  let high = noon + 24 * 60 * 60 * 1000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dayKey(new Date(middle)) < day) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}

export function tehranWindowStart(now: Date, days: 7 | 30): Date {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid reporting clock");
  const [year, month, date] = dayKey(now).split("-").map(Number);
  const start = new Date(Date.UTC(year!, month! - 1, date! - days + 1));
  return startOfTehranDay(start.toISOString().slice(0, 10));
}

export function tehranDashboardPeriod(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid reporting clock");
  const today = dayKey(now);
  const [year, month, date] = today.split("-").map(Number);
  const thirtyDayStart = new Date(Date.UTC(year!, month! - 1, date! - 29));
  const thirtyDayKey = `${thirtyDayStart.getUTCFullYear()}-${String(thirtyDayStart.getUTCMonth() + 1).padStart(2, "0")}-${String(thirtyDayStart.getUTCDate()).padStart(2, "0")}`;
  return {
    timezone: "Asia/Tehran" as const,
    localDate: today,
    todayStartUtc: startOfTehranDay(today),
    thirtyDayStartUtc: startOfTehranDay(thirtyDayKey),
    asOfUtc: now,
  };
}
