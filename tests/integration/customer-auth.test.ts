import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import {
  createAdminSecurity,
  createCustomerHttpHandler,
  createCustomerSecurity,
  readCustomerCookie,
  ScryptPasswords,
} from "@/modules/auth/server";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";
import { gregorianToJalali, jalaliToGregorian } from "@/shared/jalali-date";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";

const secret = "customer-test-secret-longer-than-thirty-two-characters";
const password = "correct-horse-customer-12345";
const code = "123456";
const proofs = { verify: async (_phone: string, proof: string) => proof === code };
const signup = { phone: "۰۹۱۲۳۴۵۶۷۸۹", code, displayName: "مشتری", birthDate: "2000-03-20" };
let replica: MongoMemoryReplSet;
let connection: mongoose.Connection;
let now = new Date("2026-01-01T00:00:00.000Z");
const clock = () => new Date(now);
let security: ReturnType<typeof createCustomerSecurity>;
beforeAll(async () => {
  Object.assign(process.env, testEnv());
  const installed = "C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe";
  const systemBinary =
    process.env.MONGOMS_SYSTEM_BINARY ??
    (process.platform === "win32" && existsSync(installed) ? installed : undefined);
  const version = systemBinary
    ? /db version v(\d+\.\d+\.\d+)/.exec(
        execFileSync(systemBinary, ["--version"], { encoding: "utf8" }),
      )?.[1]
    : undefined;
  replica = await MongoMemoryReplSet.create({
    binary: systemBinary ? { systemBinary, ...(version ? { version } : {}) } : undefined,
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  connection = await mongoose
    .createConnection(replica.getUri(isolatedResources("customer-auth").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
});
beforeEach(async () => {
  now = new Date("2026-01-01T00:00:00.000Z");
  for (const name of [
    "customers",
    "admins",
    "sessions",
    "customer_auth_throttles",
    "admin_login_throttles",
    "admin_owner_guard",
    "audit_events",
    "outbox_events",
    "_schema_migrations",
  ])
    await connection.db!.collection(name).deleteMany({});
  security = createCustomerSecurity(connection, secret, clock, proofs);
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  await replica?.stop();
});

test("signup normalizes mobile without storing a password, audits, and rejects duplicates", async () => {
  const customer = await security.auth.signup(signup, "signup-1");
  expect(customer).toMatchObject({ phone: "+989123456789", birthDate: "2000-03-20", revision: 0 });
  expect(JSON.stringify(customer)).not.toContain("passwordHash");
  const stored = await connection.db!.collection("customers").findOne({ phone: "+989123456789" });
  expect(stored).not.toHaveProperty("passwordHash");
  expect(stored!.birthDate).toEqual(new Date("2000-03-20T00:00:00.000Z"));
  expect(gregorianToJalali(customer.birthDate!)).toBe("1379-01-01");
  expect(jalaliToGregorian(gregorianToJalali(customer.birthDate!))).toBe(customer.birthDate);
  expect(
    await connection
      .db!.collection("audit_events")
      .countDocuments({ action: "customer.signed_up" }),
  ).toBe(1);
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "customer.signed_up" }),
  ).toBe(1);
  await expect(
    security.auth.signup({ ...signup, phone: "+989123456789" }, "signup-2"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await connection.db!.collection("customers").countDocuments({})).toBe(1);
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "customer.signed_up" }),
  ).toBe(1);
  expect(
    JSON.stringify(await connection.db!.collection("audit_events").find({}).toArray()),
  ).not.toContain(code);
});

test("login, rotation, logout, expiry, blocked status, and admin separation", async () => {
  const customer = await security.auth.signup(signup, "signup");
  const issued = await security.auth.login({ phone: "00989123456789", code }, null, "login");
  expect(issued.principal.id).toBe(customer.id);
  expect(await security.auth.resolve(issued.token)).toMatchObject({ id: customer.id });
  const admin = createAdminSecurity(connection, "separate-admin-secret-longer-than-32", clock);
  expect(await admin.auth.resolve(issued.token)).toBeNull();
  await admin.repository.bootstrap(
    {
      username: "owner",
      phone: "09129999999",
      displayName: "مالک",
      role: "OWNER",
      password: "owner-password-12345",
    },
    await admin.passwords.hash("owner-password-12345"),
    "admin-bootstrap",
  );
  const adminSession = await admin.auth.login(
    { username: "owner", password: "owner-password-12345" },
    null,
    "test-network",
    "admin-login",
  );
  expect(await security.auth.resolve(adminSession.token)).toBeNull();
  const rotated = await security.auth.rotate(issued.token, "rotate");
  expect(rotated.token).not.toBe(issued.token);
  expect(rotated.expiresAt).toEqual(issued.expiresAt);
  expect(await security.auth.resolve(issued.token)).toBeNull();
  await security.auth.logout(rotated.token, "logout");
  expect(await security.auth.resolve(rotated.token)).toBeNull();
  const fresh = await security.auth.login({ phone: "+989123456789", code }, null, "login2");
  now = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  expect(await security.auth.resolve(fresh.token)).toBeNull();
  now = new Date("2026-01-01T00:00:00.000Z");
  const blockedToken = await security.auth.login(
    { phone: "+989123456789", code },
    null,
    "login3",
  );
  await connection
    .db!.collection("customers")
    .updateOne({ _id: new mongoose.Types.ObjectId(customer.id) }, { $set: { status: "blocked" } });
  expect(await security.auth.resolve(blockedToken.token)).toBeNull();
  await expect(
    security.auth.login({ phone: "+989123456789", code }, null, "blocked"),
  ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
});

test("profile update is authorized and optimistic, with no birth-day shift", async () => {
  await security.auth.signup(signup, "signup");
  const issued = await security.auth.login({ phone: "09123456789", code }, null, "login");
  expect(await security.auth.profile(issued.token)).toMatchObject({
    birthDate: "2000-03-20",
    revision: 0,
  });
  const updated = await security.auth.update(
    issued.token,
    { revision: 0, birthDate: jalaliToGregorian("1403-01-01"), displayName: "نام تازه" },
    "profile",
  );
  expect(updated.birthDate).toBe(jalaliToGregorian("1403-01-01"));
  expect(gregorianToJalali(updated.birthDate!)).toBe("1403-01-01");
  expect(updated.revision).toBe(1);
  expect(
    await connection.db!.collection("customers").findOne({ phone: "+989123456789" }),
  ).toMatchObject({ birthDate: new Date(`${updated.birthDate}T00:00:00.000Z`) });
  await expect(
    security.auth.update(issued.token, { revision: 0, displayName: "stale" }, "stale"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(security.auth.profile(null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

test("generic login failures and per-account rate limiting use persistent counters", async () => {
  await security.auth.signup(signup, "signup");
  for (let index = 0; index < 5; index++) {
    await expect(
      security.auth.login({ phone: "09123456789", code: "000000" }, null, `wrong-${index}`),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  }
  await expect(
    security.auth.login({ phone: "09123456789", code }, null, "limited"),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  const failure = await connection
    .db!.collection("audit_events")
    .findOne({ action: "customer.login_rejected" });
  expect(failure!.metadata).toEqual({});
  now = new Date(now.getTime() + 16 * 60 * 1000);
  await expect(
    security.auth.login({ phone: "09123456789", code }, null, "after-window"),
  ).resolves.toHaveProperty("token");
});

test("HTTP cookies, CSRF, admin-cookie isolation, and safe DTOs", async () => {
  const handler = createCustomerHttpHandler({
    service: async () => security.auth,
    production: () => false,
    origins: () => ["http://localhost:3000"],
    now: clock,
  });
  const request = (
    operation: string,
    body: object,
    origin = "http://localhost:3000",
    cookie?: string,
  ) =>
    new Request(`http://localhost:3000/api/customer/auth/${operation}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  expect((await handler(request("signup", signup, "https://evil.example"), "signup")).status).toBe(
    403,
  );
  const created = await handler(request("signup", signup), "signup");
  expect(created.status).toBe(200);
  expect(await created.text()).not.toContain(code);
  const login = await handler(request("login", { phone: "09123456789", code }), "login");
  expect(login.status).toBe(200);
  expect(login.headers.get("set-cookie")).toContain("armani-customer-dev=");
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  expect(
    readCustomerCookie(
      new Request("http://localhost:3000", { headers: { Cookie: cookie } }),
      false,
    ),
  ).toBeTruthy();
  expect(
    readCustomerCookie(
      new Request("http://localhost:3000", {
        headers: { Cookie: cookie, "X-Admin-Role": "OWNER" },
      }),
      true,
    ),
  ).toBeNull();
  const profile = await handler(
    new Request("http://localhost:3000/api/customer/profile", { headers: { Cookie: cookie } }),
    "profile",
  );
  expect(profile.status).toBe(200);
  expect(await profile.text()).not.toContain("passwordHash");
});

test("migration 5 refuses legacy passwordless customers", async () => {
  await connection.db!.collection("customers").insertOne({
    phone: "+989199999999",
    status: "active",
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
  await expect(applyMigrations(connection, clock)).rejects.toThrow(
    /Legacy customer identities require operator review/,
  );
  expect(
    await connection.db!.collection<{ _id: number }>("_schema_migrations").findOne({ _id: 5 }),
  ).toBeNull();
});

test("migration 5 upgrades compatible legacy customers and revokes old sessions", async () => {
  const passwordHash = await new ScryptPasswords().hash(password);
  await connection.db!.collection("customers").insertOne({
    phone: "+989111111111",
    displayName: null,
    passwordHash,
    status: "active",
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
  await connection.db!.collection("sessions").insertOne({
    principalKind: "customer",
    expiresAt: new Date(now.getTime() + 10000),
  });
  expect(await applyMigrations(connection, clock)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
  ]);
  const row = await connection.db!.collection("customers").findOne({ phone: "+989111111111" });
  expect(row).toMatchObject({ authVersion: 1, birthDate: null });
  expect(row).not.toHaveProperty("passwordHash");
  expect(
    (await connection.db!.collection("sessions").findOne({ principalKind: "customer" }))!.revokedAt,
  ).toEqual(now);
});
