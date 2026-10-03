import { expect, test } from "vitest";

import {
  paymentIdentifier,
  paymentKey,
  selectProvider,
  validProviderValue,
} from "@/modules/payments";
import {
  FakePaymentProvider,
  IranianGatewayPlaceholder,
  MemoryFakeLedger,
  ProviderRegistry,
} from "@/modules/payments/server";
import { parseSettingsValues, parseSettingsWrite, settingsDefaults } from "@/modules/settings";
import { SettingsVault } from "@/modules/settings/server";
import { redact } from "@/server/observability/redact";
test("default and priority select multiple adapters without choosing disabled or fake production providers", () => {
  const choices = [
    { id: "a", enabled: true, priority: 2, mode: "sandbox" as const },
    { id: "b", enabled: true, priority: 1, mode: "sandbox" as const },
    { id: "fake", enabled: true, priority: 0, mode: "sandbox" as const },
  ];
  expect(selectProvider(choices, "a", false).id).toBe("a");
  expect(selectProvider(choices, null, true).id).toBe("b");
  expect(() => selectProvider(choices, "fake", true)).toThrow();
});
test("payment identifiers, idempotency keys, and provider values fail closed", () => {
  expect(paymentIdentifier("000000000000000000000001")).toBe("000000000000000000000001");
  expect(paymentKey("checkout_2026-0001")).toBe("checkout_2026-0001");
  expect(validProviderValue("gateway:authority_123")).toBe(true);
  for (const value of ["", "1", "../../payment", "00000000000000000000000g", { $gt: "" }])
    expect(() => paymentIdentifier(value)).toThrow();
  for (const value of ["short", "space is unsafe", "../checkout", "x".repeat(129)])
    expect(() => paymentKey(value)).toThrow();
  for (const value of ["", "provider/path", "provider?secret=x", "x".repeat(161), null])
    expect(validProviderValue(value)).toBe(false);
});
test("fake authority is deterministic and browser callback hints cannot settle it", async () => {
  const ledger = new MemoryFakeLedger(),
    adapter = new FakePaymentProvider(ledger, "https://caffe.example");
  const request = {
    paymentId: "000000000000000000000001",
    idempotencyKey: "payment-123",
    amountToman: 1000,
    callbackUrl: "https://caffe.example/callback",
    authority: null,
  };
  const signal = new AbortController().signal,
    first = await adapter.create(request, signal);
  expect(await adapter.create(request, signal)).toEqual(first);
  expect(adapter.parseCallback({ authority: first.authority, result: "success" })).toEqual({
    authority: first.authority,
  });
  expect(await adapter.verify({ ...request, authority: first.authority }, signal)).toEqual({
    kind: "pending",
  });
});
test("up to four settings entries and encrypted credential sets are supported without public secrets", () => {
  const providers = Array.from({ length: 4 }, (_, i) => ({
    id: `gateway-${i}`,
    enabled: true,
    priority: i,
    mode: "sandbox",
  }));
  const values = { ...settingsDefaults("payment"), providers, defaultProvider: "gateway-2" };
  expect(parseSettingsValues("payment", values)).toEqual(values);
  expect(() =>
    parseSettingsValues("payment", {
      ...values,
      providers: [...providers, { ...providers[0], id: "fifth" }],
    }),
  ).toThrow();
  expect(() =>
    parseSettingsValues("payment", { ...values, providers: [providers[0], providers[0]] }),
  ).toThrow();
  const credentials = JSON.stringify({
    "gateway-0": "merchant-secret-never-exposed",
    "gateway-1": "second-merchant-secret-never-exposed",
  });
  const parsed = parseSettingsWrite("payment", {
    revision: 0,
    values,
    secrets: { providerCredentials: credentials },
  });
  const vault = new SettingsVault("1".repeat(64)),
    ciphertext = vault.seal("payment", {
      providerCredentials: parsed.secrets!.providerCredentials!,
    });
  expect(ciphertext).not.toContain("merchant-secret");
  expect(vault.open("payment", ciphertext).providerCredentials).toBe(credentials);
  expect(
    redact({
      providerCredentials: credentials,
      state: "private-state",
      url: "https://caffe.example?state=private-state",
    }),
  ).toEqual({
    providerCredentials: "[REDACTED]",
    state: "[REDACTED]",
    url: "https://caffe.example?state=[REDACTED]",
  });
});
test("undocumented gateway and adapter factory failures fail safely", async () => {
  await expect(new IranianGatewayPlaceholder().verify()).rejects.toThrow("not configured");
  const registry = new ProviderRegistry(
    new Map([
      [
        "test",
        () => {
          throw new Error("merchant-secret-leak");
        },
      ],
    ]),
  );
  expect(() =>
    registry.get({ id: "test", mode: "sandbox", credential: "merchant-secret-leak" }),
  ).toThrow("configuration rejected");
});
