import type { EntityDto, UtcTimestamp } from "../../../shared/domain.ts";

export type MediaStatus = "pending" | "ready" | "rejected" | "deleted";
export type MediaAsset = EntityDto &
  Readonly<{
    objectKey: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    status: MediaStatus;
    ownerId: string;
    deletedAt: UtcTimestamp | null;
  }>;

const allowed: Record<MediaStatus, readonly MediaStatus[]> = {
  pending: ["ready", "rejected"],
  ready: ["deleted"],
  rejected: ["deleted"],
  deleted: [],
};
export function assertMediaTransition(from: MediaStatus, to: MediaStatus): void {
  if (!allowed[from].includes(to))
    throw new RangeError(`Invalid media transition: ${from} -> ${to}`);
}
