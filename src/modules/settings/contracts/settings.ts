import { ApplicationError } from "../../../shared/errors.ts";
import {
  settingsDefaults,
  type SettingsKind,
  settingsKinds,
  type SettingsSecrets,
  type SettingsValues,
} from "../domain/model.ts";

function invalid(): never {
  throw new ApplicationError("VALIDATION", "Invalid settings input");
}
export function settingsKind(value: unknown): SettingsKind {
  if (!settingsKinds.includes(value as SettingsKind)) invalid();
  return value as SettingsKind;
}
export function settingsRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !fields.includes(key))) invalid();
  return record;
}
function text(value: unknown, max = 500, required = false): string {
  if (typeof value !== "string" || value.length > max || /[<>\u0000-\u001f\u007f]/u.test(value))
    invalid();
  const result = value.trim().normalize("NFC");
  if (required && !result) invalid();
  return result;
}
function integer(value: unknown, max: number, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid();
  return value as number;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}
function choice<T extends string | number | boolean | null>(
  value: unknown,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value as T)) invalid();
  return value as T;
}
function social(value: unknown, host: string): string {
  const input = text(value, 160);
  if (!input) return "";
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== host ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9_][A-Za-z0-9_.]{0,63}\/?$/.test(url.pathname)
  )
    invalid();
  return `https://${host}/${url.pathname.split("/")[1]}`;
}
export function parseSettingsValues<K extends SettingsKind>(
  kind: K,
  input: unknown,
): SettingsValues[K] {
  const defaults = settingsDefaults(kind);
  const v = settingsRecord(input, Object.keys(defaults));
  if (Object.keys(defaults).some((key) => !(key in v))) invalid();
  let result: SettingsValues[SettingsKind];
  switch (kind) {
    case "business":
      result = {
        title: text(v.title, 100, true),
        legalName: text(v.legalName, 150),
        description: text(v.description, 1000),
        currency: choice(v.currency, ["TOMAN"]),
        timezone: choice(v.timezone, ["Asia/Tehran"]),
        minimumOrderToman: integer(v.minimumOrderToman, Number.MAX_SAFE_INTEGER),
      };
      break;
    case "contact": {
      const phone = text(v.phone, 20);
      const email = text(v.email, 254).toLowerCase();
      if (
        (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      )
        invalid();
      const coordinate = (value: unknown, max: number) => {
        if (value === null) return null;
        if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > max)
          invalid();
        return value;
      };
      const provider = choice(v.mapProvider, ["none", "google"]);
      const latitude = coordinate(v.latitude, 90),
        longitude = coordinate(v.longitude, 180);
      if (
        (provider === "none" && (latitude !== null || longitude !== null)) ||
        (provider === "google" && (latitude === null || longitude === null))
      )
        invalid();
      result = {
        phone,
        email,
        address: text(v.address, 500),
        instagramUrl: social(v.instagramUrl, "www.instagram.com"),
        telegramUrl: social(v.telegramUrl, "t.me"),
        mapProvider: provider,
        latitude,
        longitude,
      };
      break;
    }
    case "seo": {
      const titleTemplate = text(v.titleTemplate, 160, true);
      if (titleTemplate.split("%s").length !== 2 || /%(?!s)/.test(titleTemplate)) invalid();
      result = {
        title: text(v.title, 100, true),
        description: text(v.description, 320),
        titleTemplate,
        indexable: bool(v.indexable),
      };
      break;
    }
    case "payment": {
      const fakeEnabled = bool(v.fakeEnabled),
        defaultProvider = choice(v.defaultProvider, ["fake", null]);
      if ((defaultProvider !== null && !fakeEnabled) || (fakeEnabled && defaultProvider === null))
        invalid();
      result = {
        defaultProvider,
        fakeEnabled,
        fakePriority: integer(v.fakePriority, 100),
        gatewayEnabled: choice(v.gatewayEnabled, [false]),
        gatewayPriority: integer(v.gatewayPriority, 100),
        gatewayMode: choice(v.gatewayMode, ["sandbox", "production"]),
      };
      break;
    }
    case "printing": {
      const enabled = bool(v.enabled),
        bridgeId = text(v.bridgeId, 64),
        automaticPrint = bool(v.automaticPrint);
      if (
        (bridgeId && !/^[a-zA-Z0-9_-]{1,64}$/.test(bridgeId)) ||
        (enabled && !bridgeId) ||
        (!enabled && automaticPrint)
      )
        invalid();
      result = {
        enabled,
        bridgeId,
        automaticPrint,
        paperWidthMm: choice(v.paperWidthMm, [58, 80]),
        copies: integer(v.copies, 3, 1),
        footer: text(v.footer, 300),
      };
      break;
    }
    default:
      return invalid();
  }
  return result as SettingsValues[K];
}
export type SettingsWrite<K extends SettingsKind = SettingsKind> = {
  revision: number;
  values: SettingsValues[K];
  secrets?: Partial<Record<keyof SettingsSecrets, string | null>>;
  rotate: boolean;
};
export function parseSettingsWrite<K extends SettingsKind>(
  kind: K,
  input: unknown,
): SettingsWrite<K> {
  const v = settingsRecord(input, ["revision", "values", "secrets", "rotate"]);
  const revision = integer(v.revision, Number.MAX_SAFE_INTEGER - 1);
  const values = parseSettingsValues(kind, v.values);
  const rotate = v.rotate === undefined ? false : bool(v.rotate);
  if (rotate && kind !== "payment" && kind !== "printing") invalid();
  let secrets: SettingsWrite["secrets"];
  if (v.secrets !== undefined) {
    const field =
      kind === "payment" ? "gatewayCredential" : kind === "printing" ? "bridgeToken" : null;
    const fields = settingsRecord(v.secrets, field ? [field] : []);
    secrets = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === "") continue;
      if (
        value !== null &&
        (typeof value !== "string" ||
          value.length < 16 ||
          value.length > 4096 ||
          /[\u0000-\u001f\u007f]/u.test(value))
      )
        invalid();
      secrets[key as keyof SettingsSecrets] = value as string | null;
    }
  }
  return { revision, values, rotate, ...(secrets ? { secrets } : {}) };
}
export function settingsMutationKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) invalid();
  return value;
}
