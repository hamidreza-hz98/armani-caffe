import { describe, expect, it, vi } from "vitest";

import type { OwnerSettings } from "@/modules/settings";
import {
  parseSettingsValues,
  parseSettingsWrite,
  settingsDefaults,
  settingsKinds,
  settingsMapUrl,
} from "@/modules/settings";
import { type SettingsRepository, SettingsService } from "@/modules/settings/application/service";
import { SettingsVault } from "@/modules/settings/server";
import { redact } from "@/server/observability/redact";

const owner = { id: "000000000000000000000001", role: "OWNER" as const };
const cashier = { id: "000000000000000000000002", role: "CASHIER" as const };
const clock = () => new Date("2026-01-01T00:00:00Z");
const key = "1".repeat(64),
  previous = "2".repeat(64);
const credential = "sensitive-settings-value-123";

describe("typed settings contracts", () => {
  it("has deterministic, valid independent defaults for all five singletons", () => {
    for (const kind of settingsKinds)
      expect(parseSettingsValues(kind, settingsDefaults(kind))).toEqual(settingsDefaults(kind));
    settingsDefaults("business").title = "changed";
    expect(settingsDefaults("business").title).toBe("آرمانی کافه");
  });
  it("rejects unknown keys, HTML, fractional money, missing fields and invalid SEO templates", () => {
    for (const input of [
      { ...settingsDefaults("business"), minimumOrderToman: 0.5 },
      { ...settingsDefaults("business"), apiKey: credential },
      { ...settingsDefaults("business"), title: "<script>" },
      {},
    ])
      expect(() => parseSettingsValues("business", input)).toThrow();
    expect(() =>
      parseSettingsValues("seo", { ...settingsDefaults("seo"), titleTemplate: "%s %s" }),
    ).toThrow();
    expect(() =>
      parseSettingsWrite("business", {
        revision: 0,
        values: settingsDefaults("business"),
        role: "OWNER",
      }),
    ).toThrow();
  });
  it("only generates Google Maps navigation URLs from bounded coordinates", () => {
    const contact = {
      ...settingsDefaults("contact"),
      mapProvider: "google" as const,
      latitude: 35.7,
      longitude: 51.4,
    };
    expect(settingsMapUrl(parseSettingsValues("contact", contact))).toBe(
      "https://www.google.com/maps/search/?api=1&query=35.7%2C51.4",
    );
    for (const patch of [
      { mapProvider: "iframe" },
      { latitude: 91 },
      { longitude: Infinity },
      { latitude: null },
      { iframe: "<iframe src='https://evil.invalid'>" },
      { mapUrl: "javascript:alert(1)" },
    ])
      expect(() => parseSettingsValues("contact", { ...contact, ...patch })).toThrow();
  });
  it("allows only approved HTTPS social profile forms and normalizes contact text", () => {
    const contact = settingsDefaults("contact");
    expect(
      parseSettingsValues("contact", {
        ...contact,
        instagramUrl: "https://www.instagram.com/armani/",
        phone: "+982112345678",
        email: "CAFE@EXAMPLE.COM",
      }),
    ).toMatchObject({
      instagramUrl: "https://www.instagram.com/armani",
      email: "cafe@example.com",
    });
    for (const instagramUrl of [
      "javascript:alert(1)",
      "https://www.instagram.com.evil.test/armani",
      "https://user@www.instagram.com/armani",
      "https://www.instagram.com/armani?redirect=evil",
      "https://127.0.0.1/x",
    ])
      expect(() => parseSettingsValues("contact", { ...contact, instagramUrl })).toThrow();
  });
  it("requires installed providers, consistent defaults and valid print preferences", () => {
    expect(() =>
      parseSettingsValues("payment", { ...settingsDefaults("payment"), gatewayEnabled: true }),
    ).toThrow();
    expect(() =>
      parseSettingsValues("payment", { ...settingsDefaults("payment"), defaultProvider: "fake" }),
    ).toThrow();
    expect(() =>
      parseSettingsValues("printing", { ...settingsDefaults("printing"), automaticPrint: true }),
    ).toThrow();
    expect(() =>
      parseSettingsValues("printing", { ...settingsDefaults("printing"), copies: 4 }),
    ).toThrow();
  });
  it("treats omitted/blank credentials as unchanged and null as clear", () => {
    const base = { revision: 0, values: settingsDefaults("printing") };
    expect(parseSettingsWrite("printing", base).secrets).toBeUndefined();
    expect(
      parseSettingsWrite("printing", { ...base, secrets: { bridgeToken: "" } }).secrets,
    ).toEqual({});
    expect(
      parseSettingsWrite("printing", { ...base, secrets: { bridgeToken: null } }).secrets,
    ).toEqual({ bridgeToken: null });
    expect(() =>
      parseSettingsWrite("printing", { ...base, secrets: { gatewayCredential: credential } }),
    ).toThrow();
    expect(() =>
      parseSettingsWrite("printing", { ...base, secrets: { bridgeToken: "short" } }),
    ).toThrow();
  });
});
describe("settings encryption and visibility", () => {
  it("encrypts with random nonces, authenticates purpose and metadata, and reads the previous key", () => {
    const old = new SettingsVault(previous, undefined, clock),
      vault = new SettingsVault(key, previous, clock);
    const encrypted = old.seal("payment", { gatewayCredential: credential });
    expect(encrypted).not.toContain(credential);
    expect(vault.open("payment", encrypted)).toEqual({ gatewayCredential: credential });
    expect(() => vault.open("printing", encrypted)).toThrow(/cannot be decrypted/);
    expect(() => new SettingsVault(key).open("payment", encrypted)).toThrow();
    const envelope = JSON.parse(encrypted);
    envelope.encryptedAt = "2026-02-01T00:00:00Z";
    expect(() => vault.open("payment", JSON.stringify(envelope))).toThrow();
    expect(vault.seal("payment", { gatewayCredential: credential })).not.toBe(
      vault.seal("payment", { gatewayCredential: credential }),
    );
    expect(vault.fingerprint(credential)).not.toBe(old.fingerprint(credential));
    expect(vault.fingerprint(credential, old.keyId)).toBe(old.fingerprint(credential));
    expect(
      JSON.stringify(
        redact({ secrets: { gatewayCredential: credential }, encryptedPayload: encrypted }),
      ),
    ).not.toContain(credential);
    expect(
      redact({
        encryptedPayload: encrypted,
        ciphertext: encrypted,
        fingerprint: vault.fingerprint(credential),
      }),
    ).toEqual({
      encryptedPayload: "[REDACTED]",
      ciphertext: "[REDACTED]",
      fingerprint: "[REDACTED]",
    });
  });
  it("never puts payment, printing or credential metadata in public settings", async () => {
    const repository: SettingsRepository = {
      stamp: vi.fn(async () => 0),
      read: vi.fn(async () => null),
      write: vi.fn(),
    };
    const service = new SettingsService(repository);
    expect(Object.keys(await service.publicSettings())).toEqual(["business", "contact", "seo"]);
    expect(await service.read(cashier, "payment")).toEqual({
      kind: "payment",
      revision: 0,
      values: { defaultProvider: null, fakeEnabled: false, gatewayEnabled: false },
    });
    expect(await service.read(cashier, "printing")).not.toHaveProperty("credentials");
    await expect(service.read(cashier, "seo")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.read(null, "business")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      service.update(cashier, "business", "mutation-key", {}, "request-123"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.write).not.toHaveBeenCalled();
    await expect(
      new SettingsService(repository, true).update(
        owner,
        "payment",
        "mutation-key",
        {
          revision: 0,
          values: { ...settingsDefaults("payment"), fakeEnabled: true, defaultProvider: "fake" },
        },
        "request-123",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("clones cached DTOs and checks remote revisions before every hit", async () => {
    let row: OwnerSettings = {
      kind: "business",
      revision: 1,
      values: settingsDefaults("business"),
      credentials: { configured: false, keyId: null, rotatedAt: null },
    };
    const repository: SettingsRepository = {
      stamp: vi.fn(async () => row.revision),
      read: vi.fn(async () => row),
      write: vi.fn(),
    };
    const service = new SettingsService(repository);
    const first = await service.read(owner, "business");
    (first.values as { title: string }).title = "cache poisoning";
    expect((await service.read(owner, "business")).values).toHaveProperty("title", "آرمانی کافه");
    expect(repository.read).toHaveBeenCalledTimes(1);
    row = { ...row, revision: 2, values: { ...settingsDefaults("business"), title: "new" } };
    expect((await service.read(owner, "business")).values).toHaveProperty("title", "new");
    expect(repository.read).toHaveBeenCalledTimes(2);
    expect(repository.stamp).toHaveBeenCalledTimes(3);
  });
});
