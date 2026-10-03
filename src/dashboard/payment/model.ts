export type ProviderEntry = {
  id: string;
  enabled: boolean;
  priority: number;
  mode: "sandbox" | "production";
};
export type PaymentValues = {
  defaultProvider: string | null;
  providers?: ProviderEntry[];
  fakeEnabled: boolean;
  fakePriority: number;
  gatewayEnabled: false;
  gatewayPriority: number;
  gatewayMode: "sandbox" | "production";
};
export type AdapterCard = {
  id: string;
  label: string;
  installed: boolean;
  selectable: boolean;
  credentialRequired: boolean;
  callbackUrl: string;
};
export type PaymentSettingsView = {
  revision: number;
  values: PaymentValues;
  credentialConfigured: boolean;
  configuredIds: string[];
  adapters: AdapterCard[];
  production: boolean;
};
export type ProbeResult = {
  status: "healthy" | "unavailable" | "failed";
  message: string;
  checkedAt: string;
};

export function orderedProviders(values: PaymentValues): ProviderEntry[] {
  return [...(values.providers ?? [])].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
}

export function moveProvider(values: PaymentValues, id: string, direction: -1 | 1): PaymentValues {
  const providers = orderedProviders(values);
  const index = providers.findIndex((provider) => provider.id === id);
  const other = index + direction;
  if (index < 0 || other < 0 || other >= providers.length) return values;
  [providers[index], providers[other]] = [providers[other], providers[index]];
  return {
    ...values,
    providers: providers.map((provider, priority) => ({ ...provider, priority })),
  };
}

export function disableProvider(values: PaymentValues, id: string): PaymentValues {
  if (id === "fake")
    return {
      ...values,
      fakeEnabled: false,
      defaultProvider: values.defaultProvider === id ? null : values.defaultProvider,
    };
  return {
    ...values,
    defaultProvider: values.defaultProvider === id ? null : values.defaultProvider,
    providers: (values.providers ?? []).map((provider) =>
      provider.id === id ? { ...provider, enabled: false } : provider,
    ),
  };
}
