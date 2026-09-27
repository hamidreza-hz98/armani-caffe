import type { EntityDto } from "../../../shared/domain.ts";

export type Customer = EntityDto &
  Readonly<{ phone: string; displayName: string | null; status: "active" | "blocked" }>;
