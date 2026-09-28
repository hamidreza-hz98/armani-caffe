import { ApplicationError } from "../../../../shared/errors.ts";
export function productId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/.test(value))
    throw new ApplicationError("VALIDATION", "Invalid product reference");
  return value;
}
function object(value: unknown, allowed: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw new ApplicationError("VALIDATION", "Invalid product fields");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false) {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    /[<>\x00-\x1f]/.test(value) ||
    (required && !value.trim())
  )
    throw new ApplicationError("VALIDATION", "Invalid product text");
  return value.trim().normalize("NFC");
}
export function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new ApplicationError("VALIDATION", "Invalid product integer");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ApplicationError("VALIDATION", "Invalid availability");
  return value;
}
export type AdditionInput = {
  id?: string;
  name: string;
  priceToman: number;
  available: boolean;
  mediaId: string | null;
};
export type RuleInput = { inventoryItemId: string; quantity: string | number; unit: string };
function additions(raw: unknown): AdditionInput[] {
  if (!Array.isArray(raw) || raw.length > 40)
    throw new ApplicationError("VALIDATION", "Invalid additions");
  const list = raw.map((value) => {
    const v = object(value, ["id", "name", "priceToman", "available", "mediaId"]);
    return {
      ...(v.id === undefined ? {} : { id: productId(v.id) }),
      name: text(v.name, 120, true),
      priceToman: integer(v.priceToman),
      available: v.available === undefined ? true : bool(v.available),
      mediaId: v.mediaId === null || v.mediaId === undefined ? null : productId(v.mediaId),
    };
  });
  if (
    new Set(list.map((v) => v.name)).size !== list.length ||
    new Set(list.filter((v) => v.id).map((v) => v.id)).size !== list.filter((v) => v.id).length
  )
    throw new ApplicationError("VALIDATION", "Duplicate additions");
  return list;
}
function rules(raw: unknown): RuleInput[] {
  if (!Array.isArray(raw) || raw.length > 100)
    throw new ApplicationError("VALIDATION", "Invalid stock mappings");
  return raw.map((value) => {
    const v = object(value, ["inventoryItemId", "quantity", "unit"]);
    if (
      (typeof v.quantity !== "number" && typeof v.quantity !== "string") ||
      typeof v.unit !== "string"
    )
      throw new ApplicationError("VALIDATION", "Invalid stock mapping");
    return { inventoryItemId: productId(v.inventoryItemId), quantity: v.quantity, unit: v.unit };
  });
}
export type ProductFields = {
  name: string;
  categoryId: string;
  basePriceToman: number;
  description: string;
  excerpt: string;
  ingredients: string;
  mediaIds: string[];
  available: boolean;
  sortOrder: number;
  additions: AdditionInput[];
  consumptionRules: RuleInput[];
};
const fields = [
  "name",
  "categoryId",
  "basePriceToman",
  "description",
  "excerpt",
  "ingredients",
  "mediaIds",
  "available",
  "sortOrder",
  "additions",
  "consumptionRules",
];
export function parseProduct(
  raw: unknown,
  update = false,
): Partial<ProductFields> & { revision?: number } {
  const v = object(raw, update ? [...fields, "revision"] : fields);
  const out: Partial<ProductFields> & { revision?: number } = {};
  if (update) out.revision = integer(v.revision);
  if (!update || v.name !== undefined) out.name = text(v.name, 160, true);
  if (!update || v.categoryId !== undefined) out.categoryId = productId(v.categoryId);
  if (!update || v.basePriceToman !== undefined)
    out.basePriceToman = integer(v.basePriceToman === undefined ? 0 : v.basePriceToman);
  for (const [key, max] of [
    ["description", 2000],
    ["excerpt", 300],
    ["ingredients", 2000],
  ] as const)
    if (!update || v[key] !== undefined) out[key] = text(v[key] ?? "", max);
  if (!update || v.available !== undefined)
    out.available = v.available === undefined ? true : bool(v.available);
  if (!update || v.sortOrder !== undefined) out.sortOrder = integer(v.sortOrder ?? 0);
  if (!update || v.mediaIds !== undefined) {
    const ids = v.mediaIds ?? [];
    if (!Array.isArray(ids) || ids.length > 40)
      throw new ApplicationError("VALIDATION", "Invalid product images");
    out.mediaIds = ids.map(productId);
    if (new Set(out.mediaIds).size !== out.mediaIds.length)
      throw new ApplicationError("VALIDATION", "Duplicate images");
  }
  if (!update || v.additions !== undefined) out.additions = additions(v.additions ?? []);
  if (!update || v.consumptionRules !== undefined)
    out.consumptionRules = rules(v.consumptionRules ?? []);
  if (update && Object.keys(out).length === 1)
    throw new ApplicationError("VALIDATION", "Empty product update");
  return out;
}
export function parseRevision(raw: unknown) {
  return integer(object(raw, ["revision"]).revision);
}
