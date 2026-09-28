import { ApplicationError } from "../../../../shared/errors.ts";

function record(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw new ApplicationError("VALIDATION", "Invalid category input");
  return input as Record<string, unknown>;
}
export function categoryId(input: unknown): string {
  if (typeof input !== "string" || !/^[a-f0-9]{24}$/.test(input))
    throw new ApplicationError("VALIDATION", "Invalid category ID");
  return input;
}
function categoryName(input: unknown): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > 120 ||
    /[<>\u0000-\u001f\u007f]/u.test(input)
  )
    throw new ApplicationError("VALIDATION", "Invalid category name");
  return input.trim().normalize("NFC");
}
function status(input: unknown): "draft" | "published" {
  if (input !== "draft" && input !== "published")
    throw new ApplicationError("VALIDATION", "Invalid category status");
  return input;
}
function media(input: unknown): string | null {
  return input === null ? null : categoryId(input);
}
function revision(input: unknown) {
  if (
    !Number.isSafeInteger(input) ||
    (input as number) < 0 ||
    (input as number) >= Number.MAX_SAFE_INTEGER
  )
    throw new ApplicationError("VALIDATION", "Invalid revision");
  return input as number;
}
export function parseCategoryCreate(input: unknown) {
  const row = record(input, ["name", "status", "mediaId"]);
  return {
    name: categoryName(row.name),
    status: row.status === undefined ? ("draft" as const) : status(row.status),
    mediaId: row.mediaId === undefined ? null : media(row.mediaId),
  };
}
export function parseCategoryUpdate(input: unknown) {
  const row = record(input, ["revision", "name", "status", "mediaId"]);
  if (row.name === undefined && row.status === undefined && row.mediaId === undefined)
    throw new ApplicationError("VALIDATION", "Empty category update");
  return {
    revision: revision(row.revision),
    ...(row.name === undefined ? {} : { name: categoryName(row.name) }),
    ...(row.status === undefined ? {} : { status: status(row.status) }),
    ...(row.mediaId === undefined ? {} : { mediaId: media(row.mediaId) }),
  };
}
export function parseCategoryDelete(input: unknown) {
  return { revision: revision(record(input, ["revision"]).revision) };
}
export function parseCategoryReorder(input: unknown) {
  const row = record(input, ["revision", "ids"]);
  if (!Array.isArray(row.ids) || row.ids.length > 500 || new Set(row.ids).size !== row.ids.length)
    throw new ApplicationError("VALIDATION", "Invalid category order");
  return { revision: revision(row.revision), ids: row.ids.map(categoryId) };
}
export type CategoryCreate = ReturnType<typeof parseCategoryCreate>;
export type CategoryUpdate = ReturnType<typeof parseCategoryUpdate>;
export type CategoryReorder = ReturnType<typeof parseCategoryReorder>;
