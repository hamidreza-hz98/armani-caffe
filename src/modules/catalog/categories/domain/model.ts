import type { EntityDto, UtcTimestamp } from "../../../../shared/domain.ts";

export type Category = EntityDto &
  Readonly<{
    name: string;
    slug: string;
    sortOrder: number;
    status: "published" | "draft";
    deletedAt: UtcTimestamp | null;
  }>;
