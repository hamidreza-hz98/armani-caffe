import type { EntityDto, UtcTimestamp } from "../../../../shared/domain.ts";

export type Category = EntityDto &
  Readonly<{
    name: string;
    slug: string;
    mediaId: string | null;
    sortOrder: number;
    status: "published" | "draft";
    revision: number;
    deletedAt: UtcTimestamp | null;
  }>;
