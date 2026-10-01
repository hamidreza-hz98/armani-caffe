import { ApplicationError } from "../../../shared/errors.ts";

export const CART_MAX_LINES = 50;
export const CART_MAX_QUANTITY = 100;
export const CART_TTL_MS = 24 * 60 * 60 * 1000;
export type Selection = {
  productId: string;
  additionIds: string[];
  quantity: number;
  note?: string;
};
export type CartCommand =
  | ({ operation: "add" } & Selection)
  | ({ operation: "update"; itemKey: string } & Pick<
      Selection,
      "additionIds" | "quantity" | "note"
    >)
  | { operation: "remove"; itemKey: string }
  | { operation: "notes"; notes: string };
export type CartMutation = CartCommand & { revision: number; cartId: string };
const invalid = () => new ApplicationError("VALIDATION", "Invalid cart input");
export function cartRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid();
  return value as number;
}
export function cartId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/u.test(value)) throw invalid();
  return value;
}
export function parseCartMutation(value: unknown): CartMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const row = value as Record<string, unknown>;
  const allowed: Record<string, string[]> = {
    add: ["operation", "revision", "productId", "additionIds", "quantity", "note"],
    update: ["operation", "revision", "itemKey", "additionIds", "quantity", "note"],
    remove: ["operation", "revision", "itemKey"],
    notes: ["operation", "revision", "notes"],
  };
  if (typeof row.operation !== "string" || !Object.hasOwn(allowed, row.operation)) throw invalid();
  if (
    Object.keys(row).some(
      (key) => key !== "cartId" && !allowed[row.operation as string].includes(key),
    )
  )
    throw invalid();
  const revision = cartRevision(row.revision);
  const id = cartId(row.cartId);
  if (row.operation === "notes") {
    if (
      typeof row.notes !== "string" ||
      row.notes.length > 1000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(row.notes)
    )
      throw invalid();
    return { operation: "notes", revision, cartId: id, notes: row.notes.trim().normalize("NFC") };
  }
  if (
    row.operation !== "add" &&
    (typeof row.itemKey !== "string" || !/^[a-f\d]{24}(?::[a-f\d]{24}){0,20}$/u.test(row.itemKey))
  )
    throw invalid();
  if (row.operation === "remove")
    return { operation: "remove", revision, cartId: id, itemKey: row.itemKey as string };
  if (
    !Number.isSafeInteger(row.quantity) ||
    (row.quantity as number) < 1 ||
    (row.quantity as number) > CART_MAX_QUANTITY
  )
    throw invalid();
  if (
    !Array.isArray(row.additionIds) ||
    row.additionIds.length > 20 ||
    row.additionIds.some((id) => typeof id !== "string" || !/^[a-f\d]{24}$/u.test(id)) ||
    new Set(row.additionIds).size !== row.additionIds.length
  )
    throw invalid();
  if (
    row.note !== undefined &&
    (typeof row.note !== "string" ||
      row.note.length > 300 ||
      /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(row.note))
  )
    throw invalid();
  const common = {
    cartId: id,
    revision,
    quantity: row.quantity as number,
    additionIds: [...row.additionIds].sort() as string[],
    note: typeof row.note === "string" ? row.note.trim().normalize("NFC") : undefined,
  };
  if (row.operation === "add") {
    if (typeof row.productId !== "string" || !/^[a-f\d]{24}$/u.test(row.productId)) throw invalid();
    return { operation: "add", productId: row.productId, ...common };
  }
  return { operation: "update", itemKey: row.itemKey as string, ...common };
}
