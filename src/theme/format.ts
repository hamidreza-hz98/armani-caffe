const persianInteger = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });

export function formatPersianNumber(value: number, maximumFractionDigits = 0): string {
  if (!Number.isFinite(value)) throw new RangeError("Number must be finite");
  if (
    !Number.isInteger(maximumFractionDigits) ||
    maximumFractionDigits < 0 ||
    maximumFractionDigits > 20
  ) {
    throw new RangeError("maximumFractionDigits must be an integer from 0 to 20");
  }
  return maximumFractionDigits === 0
    ? persianInteger.format(value)
    : new Intl.NumberFormat("fa-IR", { maximumFractionDigits }).format(value);
}

export function formatToman(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Toman amount must be a non-negative safe integer");
  }
  return `${persianInteger.format(value)} تومان`;
}

export function formatJalaliDate(value: Date | string, withTime = false): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
  }).format(date);
}
