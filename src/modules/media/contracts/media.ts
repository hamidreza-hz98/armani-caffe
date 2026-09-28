import { ApplicationError } from "../../../shared/errors.ts";
import { parseListQuery } from "../../../shared/query.ts";
import { validateMediaInput } from "../domain/storage-policy.ts";

export type MediaActor = Readonly<{ id: string; role: "OWNER" | "CASHIER" }>;
export type MediaMetadata = Readonly<{
  title: string;
  altText: string;
  caption: string;
  visibility: "private" | "public";
  seo: { title: string; description: string; keywords: readonly string[] };
}>;
export type InitiateMedia = Readonly<{
  filename: string;
  mimeType: string;
  byteSize: number;
  metadata: MediaMetadata;
}>;
export const mediaSorts = ["createdAt", "updatedAt", "title", "byteSize"] as const;
export const mediaFilters = ["q", "mimeType", "visibility", "status", "uploaderId"] as const;
export type MediaListQuery = ReturnType<typeof parseMediaList>;

export function record(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    throw new ApplicationError("VALIDATION", "Expected an object");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new ApplicationError("VALIDATION", "Unknown input field");
  return value;
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || /[<>\u0000-\u001f\u007f]/.test(value))
    throw new ApplicationError("VALIDATION", "Invalid plain text");
  const normalized = value.trim().normalize("NFC");
  if (required && !normalized) throw new ApplicationError("VALIDATION", "Text is required");
  return normalized;
}
export function mediaId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/.test(value))
    throw new ApplicationError("VALIDATION", "Invalid media ID");
  return value;
}
export function idempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(value))
    throw new ApplicationError("VALIDATION", "Invalid idempotency key");
  return value;
}
export function parseMetadata(input: unknown): MediaMetadata {
  const value = record(input, ["title", "altText", "caption", "visibility", "seo"]);
  if (value.visibility !== "private" && value.visibility !== "public")
    throw new ApplicationError("VALIDATION", "Invalid visibility");
  const seo = record(value.seo, ["title", "description", "keywords"]);
  if (!Array.isArray(seo.keywords) || seo.keywords.length > 10)
    throw new ApplicationError("VALIDATION", "Invalid SEO keywords");
  return {
    title: text(value.title, 120, true),
    altText: text(value.altText, 200),
    caption: text(value.caption, 500),
    visibility: value.visibility,
    seo: {
      title: text(seo.title, 150),
      description: text(seo.description, 300),
      keywords: [...new Set(seo.keywords.map((keyword) => text(keyword, 40, true)))],
    },
  };
}
export function parseInitiation(input: unknown): InitiateMedia {
  const value = record(input, ["filename", "mimeType", "byteSize", "metadata"]);
  const filename = text(value.filename, 180, true);
  if (/[\\/]/.test(filename))
    throw new ApplicationError("VALIDATION", "Filename must not contain a path");
  try {
    validateMediaInput(value.byteSize as number, value.mimeType as string);
  } catch (cause) {
    throw new ApplicationError("VALIDATION", "Invalid upload type or size", { cause });
  }
  return {
    filename,
    mimeType: value.mimeType as string,
    byteSize: value.byteSize as number,
    metadata: parseMetadata(value.metadata),
  };
}
export function parseMediaList(params: URLSearchParams) {
  const query = parseListQuery(params, {
    sorts: mediaSorts,
    defaultSort: "createdAt",
    filters: mediaFilters,
  });
  if (query.pagination.skip > 10_000)
    throw new ApplicationError("VALIDATION", "Pagination is too deep");
  const f = query.filters;
  if (
    (f.visibility && !["private", "public"].includes(f.visibility)) ||
    (f.status && !["pending", "ready", "rejected", "deleted"].includes(f.status)) ||
    (f.mimeType && !["image/jpeg", "image/png", "image/webp"].includes(f.mimeType))
  )
    throw new ApplicationError("VALIDATION", "Invalid media filter");
  if (f.uploaderId) mediaId(f.uploaderId);
  return { ...query, filters: { ...f, ...(f.q !== undefined ? { q: text(f.q, 80, true) } : {}) } };
}
export type MediaSummary = Readonly<{
  id: string;
  title: string;
  altText: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  status: string;
  visibility: string;
}>;
export type MediaDetail = MediaSummary &
  Readonly<{
    caption: string;
    seo: MediaMetadata["seo"];
    revision: number;
    variants: readonly { variant: string; width: number; height: number; byteSize: number }[];
    filename?: string;
    uploaderId?: string;
    objectVersion?: string;
    sha256?: string | null;
  }>;
export type MediaUsage = Readonly<{ entityKind: "product"; entityId: string; field: "mediaIds" }>;
