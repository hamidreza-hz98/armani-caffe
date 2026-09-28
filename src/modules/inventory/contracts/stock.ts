import { ApplicationError } from "../../../shared/errors.ts";
import { baseUnit, type StockUnit, unitFactors } from "../domain/quantity.ts";

export function stockObject(raw: unknown, fields: readonly string[]) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !fields.includes(key))
  )
    throw new ApplicationError("VALIDATION", "Invalid inventory fields");
  return raw as Record<string, unknown>;
}
export function stockId(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-f0-9]{24}$/.test(raw))
    throw new ApplicationError("VALIDATION", "Invalid stock ID");
  return raw;
}
export function stockText(raw: unknown, max = 160): string {
  if (
    typeof raw !== "string" ||
    !raw.trim() ||
    raw.trim().length > max ||
    /[\x00-\x1f<>]/.test(raw)
  )
    throw new ApplicationError("VALIDATION", "Invalid stock text");
  return raw.trim();
}
export function stockInteger(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0)
    throw new ApplicationError("VALIDATION", "Invalid stock integer");
  return raw;
}
export function stockKey(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-zA-Z0-9:_-]{8,100}$/.test(raw))
    throw new ApplicationError("VALIDATION", "Invalid idempotency key");
  return raw;
}
export function parseItem(raw: unknown) {
  const input = stockObject(raw, ["name", "unit", "reorderLevel"]);
  if (
    typeof input.unit !== "string" ||
    !Object.hasOwn(unitFactors, input.unit) ||
    baseUnit(input.unit as StockUnit) !== input.unit
  )
    throw new ApplicationError("VALIDATION", "Declare a base stock unit");
  return {
    name: stockText(input.name),
    unit: input.unit as "gram" | "milliliter" | "piece",
    reorderLevel: stockInteger(input.reorderLevel ?? 0),
  };
}
export type StockRequestKind = "initial" | "purchase" | "adjustment" | "waste" | "reversal";
export function parseStockRequest(raw: unknown) {
  const input = stockObject(raw, [
    "inventoryItemId",
    "kind",
    "quantity",
    "unit",
    "reason",
    "idempotencyKey",
    "reversalOf",
  ]);
  if (!["initial", "purchase", "adjustment", "waste", "reversal"].includes(String(input.kind)))
    throw new ApplicationError("VALIDATION", "Invalid stock request kind");
  const kind = input.kind as StockRequestKind;
  if (
    kind === "reversal"
      ? input.quantity !== undefined || input.unit !== undefined || !input.reversalOf
      : input.reversalOf !== undefined
  )
    throw new ApplicationError("VALIDATION", "Invalid reversal fields");
  return {
    inventoryItemId: stockId(input.inventoryItemId),
    kind,
    quantity: input.quantity,
    unit: input.unit,
    reason: stockText(input.reason, 1000),
    idempotencyKey: stockKey(input.idempotencyKey),
    reversalOf: kind === "reversal" ? stockId(input.reversalOf) : null,
  };
}
