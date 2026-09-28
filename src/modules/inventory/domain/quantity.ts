import { ApplicationError } from "../../../shared/errors.ts";

export const unitFactors = {
  gram: 1,
  kilogram: 1000,
  milliliter: 1,
  liter: 1000,
  piece: 1,
} as const;
export type StockUnit = keyof typeof unitFactors;
export type BaseUnit = "gram" | "milliliter" | "piece";
export function baseUnit(unit: StockUnit): BaseUnit {
  return unit === "kilogram" ? "gram" : unit === "liter" ? "milliliter" : unit;
}
/** Decimal text is converted with integer arithmetic; fractional base units are forbidden. */
export function baseQuantity(value: unknown, unit: unknown, expected: BaseUnit): number {
  if (
    typeof unit !== "string" ||
    !Object.hasOwn(unitFactors, unit) ||
    baseUnit(unit as StockUnit) !== expected
  )
    throw new ApplicationError("VALIDATION", "Incompatible stock unit");
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^-?\d{1,15}(?:\.\d{1,3})?$/.test(text))
    throw new ApplicationError("VALIDATION", "Invalid stock quantity");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const denominator = BigInt(10) ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction) * BigInt(unitFactors[unit as StockUnit]);
  if (numerator % denominator !== BigInt(0))
    throw new ApplicationError("VALIDATION", "Fractional base unit");
  const result = Number(numerator / denominator) * (text.startsWith("-") ? -1 : 1);
  if (!Number.isSafeInteger(result))
    throw new ApplicationError("VALIDATION", "Stock quantity overflow");
  return result;
}
export function stockStatus(onHand: number, reorderLevel: number) {
  return onHand === 0 ? "out" : onHand <= reorderLevel ? "low" : "available";
}
