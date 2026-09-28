import { requireAdminCapability } from "../../../shared/admin-capabilities.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import {
  parseSettingsWrite,
  settingsKind,
  settingsMutationKey,
  type SettingsWrite,
} from "../contracts/settings.ts";
import {
  type OwnerSettings,
  type PublicSettings,
  type SettingsActor,
  settingsDefaults,
  type SettingsKind,
  settingsMapUrl,
  type SettingsValues,
} from "../domain/model.ts";

export interface SettingsRepository {
  stamp(kind: SettingsKind): Promise<number>;
  read(kind: SettingsKind): Promise<OwnerSettings | null>;
  write(
    kind: SettingsKind,
    input: SettingsWrite,
    actor: SettingsActor,
    key: string,
    requestId: string,
  ): Promise<OwnerSettings>;
}
export function requireSettingsActor(actor: SettingsActor | null): SettingsActor {
  if (!actor) throw new ApplicationError("UNAUTHORIZED", "Sign in required");
  if (!/^[a-f0-9]{24}$/.test(actor.id) || !["OWNER", "CASHIER"].includes(actor.role))
    throw new ApplicationError("FORBIDDEN", "Invalid settings actor");
  return actor;
}
export function requireSettingsOwner(actor: SettingsActor | null): SettingsActor {
  const authenticated = requireSettingsActor(actor);
  requireAdminCapability(authenticated, "settings.manage");
  return authenticated;
}
/** Safe DTO cache only. Each hit checks the DB revision, including other-process writes. */
export class SettingsService {
  private readonly repository: SettingsRepository;
  private readonly production: boolean;
  private readonly cache = new Map<SettingsKind, OwnerSettings>();
  constructor(repository: SettingsRepository, production = false) {
    this.repository = repository;
    this.production = production;
  }
  invalidate(kind: SettingsKind): void {
    this.cache.delete(kind);
  }
  private async snapshot(kind: SettingsKind): Promise<OwnerSettings> {
    const revision = await this.repository.stamp(kind),
      cached = this.cache.get(kind);
    if (cached?.revision === revision) return structuredClone(cached);
    const data = (await this.repository.read(kind)) ?? {
      kind,
      revision: 0,
      values: settingsDefaults(kind),
      credentials: { configured: false, keyId: null, rotatedAt: null },
    };
    this.cache.set(kind, structuredClone(data));
    return structuredClone(data);
  }
  async publicSettings(): Promise<PublicSettings> {
    const [business, contact, seo] = await Promise.all([
      this.snapshot("business"),
      this.snapshot("contact"),
      this.snapshot("seo"),
    ]);
    const c = contact.values as SettingsValues["contact"],
      b = business.values as SettingsValues["business"],
      s = seo.values as SettingsValues["seo"];
    return {
      business: {
        title: b.title,
        legalName: b.legalName,
        description: b.description,
        currency: b.currency,
        timezone: b.timezone,
        minimumOrderToman: b.minimumOrderToman,
      },
      contact: {
        phone: c.phone,
        email: c.email,
        address: c.address,
        instagramUrl: c.instagramUrl,
        telegramUrl: c.telegramUrl,
        mapProvider: c.mapProvider,
        latitude: c.latitude,
        longitude: c.longitude,
        mapUrl: settingsMapUrl(c),
      },
      seo: {
        title: s.title,
        description: s.description,
        titleTemplate: s.titleTemplate,
        indexable: s.indexable,
      },
    };
  }
  async read(actor: SettingsActor | null, kindInput: unknown) {
    const authenticated = requireSettingsActor(actor),
      kind = settingsKind(kindInput);
    requireAdminCapability(authenticated, kind === "seo" ? "settings.seo.read" : "settings.read");
    const row = await this.snapshot(kind);
    if (authenticated.role === "OWNER") return row;
    if (kind === "business" || kind === "contact")
      return { kind, revision: row.revision, values: row.values };
    if (kind === "printing") {
      const v = row.values as SettingsValues["printing"];
      return {
        kind,
        revision: row.revision,
        values: {
          enabled: v.enabled,
          paperWidthMm: v.paperWidthMm,
          copies: v.copies,
          automaticPrint: v.automaticPrint,
          footer: v.footer,
        },
      };
    }
    const v = row.values as SettingsValues["payment"];
    return {
      kind,
      revision: row.revision,
      values: {
        defaultProvider: v.defaultProvider,
        fakeEnabled: v.fakeEnabled,
        gatewayEnabled: v.gatewayEnabled,
      },
    };
  }
  async update(
    actor: SettingsActor | null,
    kindInput: unknown,
    keyInput: unknown,
    input: unknown,
    requestId: string,
  ): Promise<OwnerSettings> {
    const authenticated = requireSettingsOwner(actor),
      kind = settingsKind(kindInput),
      key = settingsMutationKey(keyInput);
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId))
      throw new ApplicationError("VALIDATION", "Invalid request correlation");
    const command = parseSettingsWrite(kind, input);
    if (
      this.production &&
      kind === "payment" &&
      (command.values as SettingsValues["payment"]).fakeEnabled
    )
      throw new ApplicationError("VALIDATION", "Fake payments cannot be enabled in production");
    const result = await this.repository.write(kind, command, authenticated, key, requestId);
    this.invalidate(kind);
    return result;
  }
}
