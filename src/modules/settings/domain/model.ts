export const settingsKinds = ["business", "contact", "seo", "payment", "printing"] as const;
export type SettingsKind = (typeof settingsKinds)[number];
export type SettingsValues = {
  business: {
    title: string;
    legalName: string;
    description: string;
    currency: "TOMAN";
    timezone: "Asia/Tehran";
    minimumOrderToman: number;
  };
  contact: {
    phone: string;
    email: string;
    address: string;
    instagramUrl: string;
    telegramUrl: string;
    mapProvider: "none" | "google";
    latitude: number | null;
    longitude: number | null;
  };
  seo: { title: string; description: string; titleTemplate: string; indexable: boolean };
  payment: {
    defaultProvider: "fake" | null;
    fakeEnabled: boolean;
    fakePriority: number;
    gatewayEnabled: false;
    gatewayPriority: number;
    gatewayMode: "sandbox" | "production";
  };
  printing: {
    enabled: boolean;
    bridgeId: string;
    paperWidthMm: 58 | 80;
    copies: number;
    automaticPrint: boolean;
    footer: string;
  };
};
export type SettingsActor = Readonly<{ id: string; role: "OWNER" | "CASHIER" }>;
export type SettingsDocument<K extends SettingsKind = SettingsKind> = Readonly<{
  kind: K;
  revision: number;
  values: Readonly<SettingsValues[K]>;
}>;
export type CredentialState = Readonly<{
  configured: boolean;
  keyId: string | null;
  rotatedAt: string | null;
}>;
export type OwnerSettings<K extends SettingsKind = SettingsKind> = SettingsDocument<K> & {
  credentials: CredentialState;
};
export type SettingsSecrets = { gatewayCredential?: string; bridgeToken?: string };
export type PublicSettings = Readonly<{
  business: SettingsValues["business"];
  contact: SettingsValues["contact"] & { mapUrl: string | null };
  seo: SettingsValues["seo"];
}>;

export function settingsDefaults<K extends SettingsKind>(kind: K): SettingsValues[K] {
  const values: SettingsValues = {
    business: {
      title: "آرمانی کافه",
      legalName: "",
      description: "",
      currency: "TOMAN",
      timezone: "Asia/Tehran",
      minimumOrderToman: 0,
    },
    contact: {
      phone: "",
      email: "",
      address: "",
      instagramUrl: "",
      telegramUrl: "",
      mapProvider: "none",
      latitude: null,
      longitude: null,
    },
    seo: {
      title: "آرمانی کافه",
      description: "",
      titleTemplate: "%s | آرمانی کافه",
      indexable: false,
    },
    payment: {
      defaultProvider: null,
      fakeEnabled: false,
      fakePriority: 0,
      gatewayEnabled: false,
      gatewayPriority: 1,
      gatewayMode: "sandbox",
    },
    printing: {
      enabled: false,
      bridgeId: "",
      paperWidthMm: 80,
      copies: 1,
      automaticPrint: false,
      footer: "",
    },
  };
  return values[kind];
}
/** Approved navigation URL, never an iframe or caller-supplied URL. */
export function settingsMapUrl(contact: SettingsValues["contact"]): string | null {
  if (contact.mapProvider !== "google" || contact.latitude === null || contact.longitude === null)
    return null;
  const url = new URL("https://www.google.com/maps/search/");
  url.search = new URLSearchParams({
    api: "1",
    query: `${contact.latitude},${contact.longitude}`,
  }).toString();
  return url.toString();
}
