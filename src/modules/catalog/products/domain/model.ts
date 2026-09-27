import type { EntityDto, TomanAmount, UtcTimestamp } from "../../../../shared/domain.ts";

export type Product = EntityDto &
  Readonly<{
    categoryId: string;
    name: string;
    slug: string;
    description: string;
    basePriceToman: TomanAmount;
    mediaIds: readonly string[];
    status: "draft" | "published" | "archived";
    available: boolean;
    deletedAt: UtcTimestamp | null;
  }>;

export type ProductAddition = EntityDto &
  Readonly<{
    productId: string;
    name: string;
    priceToman: TomanAmount;
    available: boolean;
    sortOrder: number;
  }>;
