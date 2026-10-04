import { describe, expect, it } from "vitest";

import { parseAdminCreate, parseAdminUpdate } from "@/modules/admins/contracts/admin";
import { parseAdminLogin } from "@/modules/auth/contracts/admin-auth";
import { adminCookieName } from "@/modules/auth/domain/admin-session";
import { customerCookieName } from "@/modules/auth/domain/customer-session";
import { adminCookie, readAdminCookie, ScryptPasswords } from "@/modules/auth/server";
import {
  adminCapabilities,
  adminCapabilityMap,
  requireAdminCapability,
} from "@/shared/admin-capabilities";
import { ApplicationError, errorStatus, serializeError } from "@/shared/errors";

const token = "A".repeat(43);
describe("admin authentication primitives", () => {
  it("uses memory-hard versioned salted hashes and constant-format dummy verification", async () => {
    const passwords = new ScryptPasswords(),
      one = await passwords.hash("correct-horse-battery-123456"),
      two = await passwords.hash("correct-horse-battery-123456");
    expect(one).toMatch(/^scrypt\$v1\$131072\$8\$1\$/);
    expect(one).not.toBe(two);
    expect(await passwords.verify("correct-horse-battery-123456", one)).toBe(true);
    expect(await passwords.verify("incorrect", one)).toBe(false);
    expect(await passwords.verify("incorrect", null)).toBe(false);
    expect(await passwords.verify("incorrect", "legacy-hash")).toBe(false);
  }, 20_000);
  it("keeps admin and customer cookie namespaces separate and rejects duplicates", () => {
    expect(adminCookieName(true)).toBe("__Host-armani-admin");
    expect(customerCookieName(true)).toBe("__Host-armani-customer");
    expect(adminCookieName(false)).not.toBe(customerCookieName(false));
    const expires = new Date(Date.now() + 60_000),
      header = adminCookie(token, expires, true);
    expect(header).toContain("Path=/; HttpOnly; SameSite=Strict;");
    expect(header).toContain("; Secure");
    expect(header).not.toContain("Domain=");
    expect(
      readAdminCookie(
        new Request("https://example.com", { headers: { Cookie: `__Host-armani-admin=${token}` } }),
        true,
      ),
    ).toBe(token);
    expect(
      readAdminCookie(
        new Request("https://example.com", {
          headers: { Cookie: `__Host-armani-admin=${token}; __Host-armani-admin=${token}` },
        }),
        true,
      ),
    ).toBeNull();
    expect(
      readAdminCookie(
        new Request("https://example.com", {
          headers: { Cookie: `__Host-armani-customer=${token}` },
        }),
        true,
      ),
    ).toBeNull();
  });
  it("centralizes capabilities and denies malformed/absent actors", () => {
    const owner = { id: "000000000000000000000001", role: "OWNER" as const },
      cashier = { ...owner, role: "CASHIER" as const };
    for (const permission of adminCapabilities)
      expect(requireAdminCapability(owner, permission)).toBe(owner);
    for (const permission of adminCapabilityMap.CASHIER)
      expect(requireAdminCapability(cashier, permission)).toBe(cashier);
    expect(() => requireAdminCapability(cashier, "admins.manage")).toThrow();
    expect(() => requireAdminCapability(null, "admin.access")).toThrow();
  });
  it("rejects mass assignment and returns generic credential/throttle responses", () => {
    expect(parseAdminLogin({ username: "OWNER.Name", password: "wrong" }).username).toBe(
      "owner.name",
    );
    expect(
      parseAdminLogin({ username: "Owner.Example+Cafe@Example.COM", password: "wrong" }).username,
    ).toBe("owner.example+cafe@example.com");
    expect(() =>
      parseAdminLogin({ username: "owner..name@example.com", password: "wrong" }),
    ).toThrow();
    expect(() => parseAdminLogin({ username: "owner", password: "x", role: "OWNER" })).toThrow();
    expect(() =>
      parseAdminCreate({
        username: "owner",
        password: "short",
        phone: "09123456789",
        displayName: "مالک",
        role: "OWNER",
      }),
    ).toThrow();
    expect(() =>
      parseAdminUpdate({
        username: "owner",
        phone: "09123456789",
        displayName: "مالک",
        role: "OWNER",
        status: "active",
        revision: 0,
        passwordHash: "injected",
      }),
    ).toThrow();
    expect(
      serializeError(new ApplicationError("INVALID_CREDENTIALS", "Username exists"), "req-123"),
    ).toMatchObject({ code: "INVALID_CREDENTIALS", message: "نام کاربری یا رمز عبور معتبر نیست." });
    expect(errorStatus("INVALID_CREDENTIALS")).toBe(401);
    expect(errorStatus("RATE_LIMITED")).toBe(429);
  });
});
