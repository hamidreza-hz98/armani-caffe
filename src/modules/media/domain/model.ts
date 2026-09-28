import type { EntityDto, UtcTimestamp } from "../../../shared/domain.ts";

export type MediaStatus = "pending" | "ready" | "rejected" | "deleted";
export type MediaAsset = EntityDto &
  Readonly<{
    objectKey: string;
    mimeType: string;
    byteSize: number;
    sha256: string | null;
    filename: string;
    objectVersion: string;
    width: number | null;
    height: number | null;
    title: string;
    altText: string;
    caption: string;
    seo: Readonly<{ title: string; description: string; keywords: readonly string[] }>;
    visibility: "private" | "public";
    uploaderId: string;
    variants: readonly Readonly<{
      key: string;
      variant: "original" | "small" | "large";
      mimeType: "image/webp";
      byteSize: number;
      width: number;
      height: number;
      sha256: string;
    }>[];
    status: MediaStatus;
    ownerId: string;
    deletedAt: UtcTimestamp | null;
  }>;

const allowed: Record<MediaStatus, readonly MediaStatus[]> = {
  pending: ["ready", "rejected", "deleted"],
  ready: ["deleted"],
  rejected: ["deleted"],
  deleted: [],
};
export function assertMediaTransition(from: MediaStatus, to: MediaStatus): void {
  if (!allowed[from].includes(to))
    throw new RangeError(`Invalid media transition: ${from} -> ${to}`);
}
