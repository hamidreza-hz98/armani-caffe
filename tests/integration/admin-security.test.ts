import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import { createAdminsHttpHandler } from "@/modules/admins/server";
import {
  createAdminAuthHttpHandler,
  createAdminSecurity,
  readAdminCookie,
} from "@/modules/auth/server";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";

let replica: MongoMemoryReplSet, connection: mongoose.Connection;
let time = new Date("2026-01-01T00:00:00.000Z");
const clock = () => new Date(time),
  password = "correct-horse-battery-123456";
const ownerInput = {
  username: "owner",
  password,
  displayName: "مالک",
  phone: "09123456789",
  role: "OWNER" as const,
};
let security: ReturnType<typeof createAdminSecurity>,
  owner: Awaited<ReturnType<typeof security.repository.bootstrap>>;
let ownerToken: string;
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
    .createConnection(replica.getUri(isolatedResources("admin-security").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
});
beforeEach(async () => {
  time = new Date("2026-01-01T00:00:00.000Z");
  for (const name of [
    "admins",
    "sessions",
    "admin_owner_guard",
    "admin_login_throttles",
    "audit_events",
    "outbox_events",
    "_schema_migrations",
  ])
    await connection.db!.collection(name).deleteMany({});
  security = createAdminSecurity(
    connection,
    "test-admin-session-secret-longer-than-32-chars",
    clock,
  );
  owner = await security.repository.bootstrap(
    ownerInput,
    await security.passwords.hash(password),
    "bootstrap-request",
  );
  ownerToken = (
    await security.auth.login(
      { username: "owner", password },
      null,
      "test-network",
      "login-request",
    )
  ).token;
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  await replica?.stop();
});

test("explicit bootstrap is audited, unique and does not store or log plaintext", async () => {
  expect(owner.role).toBe("OWNER");
  const row = await connection.db!.collection("admins").findOne({ username: "owner" });
  expect(row!.passwordHash).toMatch(/^scrypt\$v1\$/);
  expect(row!.passwordHash).not.toContain(password);
  expect(row!.lastLoginAt).toEqual(time);
  await expect(
    security.repository.bootstrap(ownerInput, row!.passwordHash, "repeat-bootstrap"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  for (const name of ["audit_events", "outbox_events", "admins"])
    expect(JSON.stringify(await connection.db!.collection(name).find({}).toArray())).not.toContain(
      password,
    );
  expect(
    await connection
      .db!.collection("audit_events")
      .countDocuments({ action: "admin.bootstrapped" }),
  ).toBe(1);
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "admin.bootstrapped" }),
  ).toBe(1);
});

test("login errors are generic, unknown users cost a hash, and account throttling is shared", async () => {
  await expect(
    security.auth.login(
      { username: "unknown", password: "wrong" },
      null,
      "test-network",
      "wrong-1",
    ),
  ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  await expect(
    security.auth.login({ username: "owner", password: "wrong" }, null, "test-network", "wrong-2"),
  ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  const rows = await connection
    .db!.collection("audit_events")
    .find({ action: "admin.login_rejected" })
    .toArray();
  expect(rows).toHaveLength(2);
  expect(JSON.stringify(rows)).not.toContain('"username":"unknown"');
  expect(JSON.stringify(rows)).not.toContain('"password":"wrong"');
  for (let i = 0; i < 3; i++)
    await expect(
      security.auth.login(
        { username: "owner", password: "wrong" },
        null,
        "test-network",
        `wrong-${i + 3}`,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  const anotherProcess = createAdminSecurity(
    connection,
    "test-admin-session-secret-longer-than-32-chars",
    clock,
  );
  await expect(
    anotherProcess.auth.login({ username: "owner", password }, null, "test-network", "blocked-1"),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(await connection.db!.collection("admin_login_throttles").countDocuments()).toBeGreaterThan(
    0,
  );
});

test("new login replaces the supplied session, rotation revokes old token, logout revokes rotated token", async () => {
  const first = ownerToken;
  const second = await security.auth.login(
    { username: "owner", password },
    first,
    "test-network",
    "login-again",
  );
  expect(second.token).not.toBe(first);
  expect(await security.auth.resolve(first)).toBeNull();
  const rotated = await security.auth.rotate(second.token, "rotate-request");
  expect(rotated.token).not.toBe(second.token);
  expect(rotated.expiresAt).toEqual(second.expiresAt);
  expect(await security.auth.resolve(second.token)).toBeNull();
  expect(await security.auth.resolve(rotated.token)).toMatchObject({ id: owner.id, role: "OWNER" });
  await security.auth.logout(rotated.token, "logout-request");
  expect(await security.auth.resolve(rotated.token)).toBeNull();
  const rows = await connection
    .db!.collection("sessions")
    .find({ principalKind: "admin" })
    .toArray();
  expect(JSON.stringify(rows)).not.toContain(first);
  expect(JSON.stringify(rows)).not.toContain(rotated.token);
  expect(rows.every((row) => row.revokedAt instanceof Date)).toBe(true);
});

test("absolute expiry, idle expiry, inactive status and customer token isolation fail closed", async () => {
  expect(await security.auth.resolve(ownerToken)).toMatchObject({ id: owner.id });
  time = new Date(time.getTime() + 31 * 60 * 1000);
  expect(await security.auth.resolve(ownerToken)).toBeNull();
  time = new Date("2026-01-01T08:00:00.001Z");
  expect(await security.auth.resolve(ownerToken)).toBeNull();
  time = new Date("2026-01-01T00:00:00.000Z");
  await connection
    .db!.collection("admins")
    .updateOne({ username: "owner" }, { $set: { status: "disabled" } });
  expect(await security.auth.resolve(ownerToken)).toBeNull();
  await connection
    .db!.collection("admins")
    .updateOne({ username: "owner" }, { $set: { status: "active" } });
  expect(await security.auth.resolve(ownerToken)).toMatchObject({ id: owner.id });
  await connection
    .db!.collection("sessions")
    .updateOne({ principalKind: "admin" }, { $set: { principalKind: "customer" } });
  expect(await security.auth.resolve(ownerToken)).toBeNull();
});

test("the final active owner cannot be disabled, demoted or deleted", async () => {
  for (const values of [
    { role: "OWNER", status: "disabled" },
    { role: "CASHIER", status: "active" },
  ]) {
    await expect(
      security.admins.update(
        ownerToken,
        owner.id,
        {
          username: owner.username,
          displayName: owner.displayName,
          phone: owner.phone,
          ...values,
          revision: 0,
        },
        "owner-update",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }
  await expect(
    security.admins.delete(ownerToken, owner.id, { revision: 0 }, "owner-delete"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await connection
      .db!.collection("admins")
      .countDocuments({ role: "OWNER", status: "active", deletedAt: null }),
  ).toBe(1);
  expect(
    await connection.db!.collection("audit_events").countDocuments({ action: "admin.deleted" }),
  ).toBe(0);
});

test("cashier cannot manage admins; owner can create/reset/disable and sessions are revoked", async () => {
  const cashier = await security.admins.create(
    ownerToken,
    {
      username: "cashier",
      displayName: "صندوقدار",
      phone: "09123456788",
      role: "CASHIER",
      password,
    },
    "create-cashier",
  );
  const issued = await security.auth.login(
    { username: "cashier", password },
    null,
    "other-network",
    "cashier-login",
  );
  await expect(
    security.admins.create(
      issued.token,
      {
        username: "intruder",
        displayName: "دسترسی",
        phone: "09123456787",
        role: "OWNER",
        password,
      },
      "cashier-forge",
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await security.admins.list(ownerToken)).toMatchObject({ total: 2 });
  await security.admins.resetPassword(
    ownerToken,
    cashier.id,
    { password: "replacement-password-1234" },
    "reset-cashier",
  );
  expect(await security.auth.resolve(issued.token)).toBeNull();
  await expect(
    security.auth.login({ username: "cashier", password }, null, "other-network", "old-password"),
  ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  const newLogin = await security.auth.login(
    { username: "cashier", password: "replacement-password-1234" },
    null,
    "other-network",
    "new-password",
  );
  expect(newLogin.principal.role).toBe("CASHIER");
  await security.admins.update(
    ownerToken,
    cashier.id,
    {
      username: cashier.username,
      displayName: cashier.displayName,
      phone: cashier.phone,
      role: "CASHIER",
      status: "disabled",
      revision: 1,
    },
    "disable-cashier",
  );
  expect(await security.auth.resolve(newLogin.token)).toBeNull();
});

test("two concurrent owners cannot both remove each other", async () => {
  const second = await security.admins.create(
    ownerToken,
    {
      username: "other-owner",
      displayName: "مالک دوم",
      phone: "09123456788",
      role: "OWNER",
      password,
    },
    "create-owner",
  );
  const otherToken = (
    await security.auth.login(
      { username: "other-owner", password },
      null,
      "other-network",
      "other-login",
    )
  ).token;
  const results = await Promise.allSettled([
    security.admins.delete(ownerToken, second.id, { revision: 0 }, "delete-second"),
    security.admins.delete(otherToken, owner.id, { revision: 0 }, "delete-first"),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(
    await connection
      .db!.collection("admins")
      .countDocuments({ role: "OWNER", status: "active", deletedAt: null }),
  ).toBe(1);
});

test("migration 4 refuses unknown legacy password hashes and revokes legacy sessions", async () => {
  await connection.db!.collection("admins").deleteMany({});
  await connection.db!.collection("admins").insertOne({
    username: "legacy",
    phone: "+989111111111",
    role: "OWNER",
    status: "active",
    passwordHash: "md5:legacy",
  });
  await expect(applyMigrations(connection, clock)).rejects.toThrow(/operator review/);
  expect(
    (await connection.db!.collection("admins").findOne({ username: "legacy" }))!.authVersion,
  ).toBeUndefined();
  await connection.db!.collection("admins").deleteMany({});
  await connection
    .db!.collection("sessions")
    .insertOne({ principalKind: "admin", expiresAt: new Date(time.getTime() + 10000) });
  expect(await applyMigrations(connection, clock)).toEqual([4, 5, 6, 7, 8]);
  expect(
    (await connection.db!.collection("sessions").findOne({ principalKind: "admin" }))!.revokedAt,
  ).toEqual(time);
});

test("HTTP login sets isolated HTTP-only cookie; CSRF and role checks protect admin writes", async () => {
  const authHandler = createAdminAuthHttpHandler({
    service: async () => security.auth,
    production: () => true,
    origins: () => ["https://cafe.example"],
    network: () => "test-network",
    now: clock,
  });
  const request = (path: string, data: unknown, cookie?: string, origin = "https://cafe.example") =>
    new Request(`https://cafe.example${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(data),
    });
  const wrongOrigin = await authHandler(
    request(
      "/api/admin/auth/login",
      { username: "owner", password },
      undefined,
      "https://evil.invalid",
    ),
    "login",
  );
  expect(wrongOrigin.status).toBe(403);
  expect(wrongOrigin.headers.get("set-cookie")).toBeNull();
  const login = await authHandler(
    request("/api/admin/auth/login", { username: "owner", password }),
    "login",
  );
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!;
  expect(cookie).toContain("__Host-armani-admin=");
  expect(cookie).toContain("HttpOnly; SameSite=Strict");
  expect(cookie).toContain("; Secure");
  const cookieHeader = cookie.split(";")[0];
  const token = readAdminCookie(
    new Request("https://cafe.example", { headers: { Cookie: cookieHeader } }),
    true,
  );
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const me = await authHandler(
    new Request("https://cafe.example/api/admin/auth/session", {
      headers: { Cookie: cookieHeader },
    }),
    "session",
  );
  expect(me.status).toBe(200);
  expect((await me.json()).value).toMatchObject({ role: "OWNER", id: owner.id });
  const adminsHandler = createAdminsHttpHandler({
    service: async () => security.admins,
    authenticate: async () => await security.auth.resolve(token),
    token: () => token,
    origins: () => ["https://cafe.example"],
  });
  const denied = await adminsHandler(
    request("/api/admins", { username: "cashier" }, cookieHeader, "https://evil.invalid"),
    "create",
  );
  expect(denied.status).toBe(403);
  const logout = await authHandler(request("/api/admin/auth/logout", {}, cookieHeader), "logout");
  expect(logout.status).toBe(200);
  expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(await security.auth.resolve(token)).toBeNull();
});
