import type { EntityDto } from "../../../shared/domain.ts";

export type SettingsKind = "business" | "contact" | "seo" | "payment" | "printing";
export type SettingsDocument = EntityDto &
  Readonly<{
    kind: SettingsKind;
    revision: number;
    /** Publicly safe fields only. Provider keys are encrypted in persistence and omitted here. */
    values: Readonly<Record<string, string | number | boolean | null>>;
  }>;
