import { parseUtcTimestamp } from "./date.ts";

declare const tomanBrand: unique symbol;
declare const utcBrand: unique symbol;

export type TomanAmount = number & { readonly [tomanBrand]: true };
export type UtcTimestamp = string & { readonly [utcBrand]: true };

export function asToman(value: number): TomanAmount {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Toman must be a non-negative safe integer");
  return value as TomanAmount;
}

export function asUtcTimestamp(value: string): UtcTimestamp {
  parseUtcTimestamp(value);
  return value as UtcTimestamp;
}

export type EntityDto = Readonly<{ id: string; createdAt: UtcTimestamp; updatedAt: UtcTimestamp }>;
