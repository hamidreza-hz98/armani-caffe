import { describe, expect, it, vi } from "vitest";

import { disableProvider, moveProvider, orderedProviders } from "@/dashboard/payment/model";
import { probePaymentAdapter } from "@/dashboard/payment/server";
import { settingsDefaults } from "@/modules/settings";
import { type SettingsRepository, SettingsService } from "@/modules/settings/application/service";

import { testEnv } from "../fixtures/config.mjs";

const owner = { id: "000000000000000000000001", role: "OWNER" as const };

describe("payment settings presentation rules", () => {
  const values = {
    ...settingsDefaults("payment"),
    defaultProvider: "second",
    providers: [
      { id: "first", enabled: true, priority: 0, mode: "sandbox" as const },
      { id: "second", enabled: true, priority: 1, mode: "production" as const },
      { id: "third", enabled: false, priority: 2, mode: "sandbox" as const },
    ],
  };
  it("moves priorities contiguously without losing provider data", () => {
    const moved = moveProvider(values, "second", -1);
    expect(orderedProviders(moved).map((provider) => [provider.id, provider.priority])).toEqual([
      ["second", 0],
      ["first", 1],
      ["third", 2],
    ]);
    expect(moved.providers?.find((provider) => provider.id === "second")?.mode).toBe("production");
  });
  it("clears default when disabling it, but preserves other entries", () => {
    const disabled = disableProvider(values, "second");
    expect(disabled.defaultProvider).toBeNull();
    expect(disabled.providers?.find((provider) => provider.id === "second")?.enabled).toBe(false);
    expect(disabled.providers?.find((provider) => provider.id === "first")?.enabled).toBe(true);
  });
  it("rejects uninstalled provider IDs and credential maps before a write", async () => {
    const repository: SettingsRepository = {
      stamp: vi.fn(async () => 0),
      read: vi.fn(async () => null),
      write: vi.fn(),
    };
    const service = new SettingsService(repository, false, ["first"]);
    await expect(
      service.update(owner, "payment", "payment-key-one", { revision: 0, values }, "request-123"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      service.update(
        owner,
        "payment",
        "payment-key-two",
        {
          revision: 0,
          values: settingsDefaults("payment"),
          secrets: { providerCredentials: JSON.stringify({ second: "not-a-real-credential-123" }) },
        },
        "request-123",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(repository.write).not.toHaveBeenCalled();
  });
  it("distinguishes a passing local fake self-check from an unavailable bank probe", async () => {
    Object.assign(process.env, testEnv());
    await expect(probePaymentAdapter("fake", owner)).resolves.toMatchObject({ status: "healthy" });
    await expect(probePaymentAdapter("iranian-gateway", owner)).resolves.toMatchObject({
      status: "unavailable",
    });
  });
});
