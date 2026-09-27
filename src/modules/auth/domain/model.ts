import type { EntityDto, UtcTimestamp } from "../../../shared/domain.ts";

export type Session = EntityDto &
  Readonly<{
    principalKind: "admin" | "customer";
    principalId: string;
    expiresAt: UtcTimestamp;
    revokedAt: UtcTimestamp | null;
    lastUsedAt: UtcTimestamp | null;
  }>;
