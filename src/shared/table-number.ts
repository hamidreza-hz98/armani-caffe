/** A QR table identifier is an integer, never free-form order notes. */
export function parseTableNumber(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/u.test(value)) return null;
  const number = Number(value);
  return number <= 999 ? number : null;
}

export function validTableNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 999;
}
