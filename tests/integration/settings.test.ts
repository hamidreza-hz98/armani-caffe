import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import { settingsDefaults } from "@/modules/settings";
import { MongoSettingsRepository } from "@/modules/settings/infrastructure/repository";
import {
  createSettingsHttpHandler,
  createSettingsRepository,
  settingsSchema,
  SettingsService,
  SettingsVault,
} from "@/modules/settings/server";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";

import { testEnv } from "../fixtures/config.mjs";
import { fixedClock, isolatedResources } from "../fixtures/isolation";

let replica: MongoMemoryReplSet, connection: mongoose.Connection, service: SettingsService;
const owner = { id: "000000000000000000000001", role: "OWNER" as const },
  cashier = { id: "000000000000000000000002", role: "CASHIER" as const };
const clock = fixedClock(),
  key = "1".repeat(64),
  token = "never-return-this-bridge-token";
const vault = new SettingsVault(key, undefined, clock);
const command = (revision = 0, title = "کافهٔ تست") => ({
  revision,
  values: { ...settingsDefaults("business"), title },
});
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
    .createConnection(replica.getUri(isolatedResources("settings").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
});
beforeEach(async () => {
  for (const name of [
    "settings",
    "settings_receipts",
    "audit_events",
    "outbox_events",
    "_schema_migrations",
  ])
    await connection.db!.collection(name).deleteMany({});
  service = new SettingsService(createSettingsRepository(connection, vault, clock));
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  await replica?.stop();
});

test("defaults do not write rows; updates commit typed singleton, audit and outbox together", async () => {
  expect((await service.publicSettings()).business.title).toBe("آرمانی کافه");
  expect(await connection.db!.collection("settings").countDocuments()).toBe(0);
  const result = await service.update(
    owner,
    "business",
    "business-first",
    command(),
    "request-123",
  );
  expect(result.revision).toBe(1);
  const [audit, outbox] = await Promise.all([
    connection.db!.collection("audit_events").findOne({}),
    connection.db!.collection("outbox_events").findOne({}),
  ]);
  expect(audit).toMatchObject({
    area: "settings",
    action: "settings.updated",
    actor: { kind: "admin", id: owner.id },
    requestId: "request-123",
  });
  expect(outbox).toMatchObject({
    eventType: "settings.updated",
    payload: { kind: "business", revision: 1 },
  });
  expect((await service.publicSettings()).business.title).toBe("کافهٔ تست");
  expect(await connection.db!.collection("settings").countDocuments()).toBe(1);
});
test("concurrent CAS updates yield one winner and no extra events", async () => {
  await service.update(owner, "business", "business-first", command(), "request-123");
  const results = await Promise.allSettled([
    service.update(owner, "business", "concurrent-a", command(1, "A"), "request-123"),
    service.update(owner, "business", "concurrent-b", command(1, "B"), "request-123"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT" },
  });
  expect(await connection.db!.collection("audit_events").countDocuments()).toBe(2);
  expect(await connection.db!.collection("outbox_events").countDocuments()).toBe(2);
});
test("concurrent identical retries return one safe receipt without duplicate effects", async () => {
  const results = await Promise.all([
    service.update(owner, "business", "same-key-123", command(), "request-123"),
    service.update(owner, "business", "same-key-123", command(), "request-456"),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await connection.db!.collection("settings_receipts").countDocuments()).toBe(1);
  expect(await connection.db!.collection("audit_events").countDocuments()).toBe(1);
  await expect(
    service.update(owner, "business", "same-key-123", command(0, "different"), "request-123"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
test("transaction failure rolls back settings, receipt, audit and outbox", async () => {
  const repository = new MongoSettingsRepository(
    connection,
    vault,
    (_change, run) =>
      connection.transaction(async (session) => {
        await run(session);
        throw new Error("injected failure");
      }),
    clock,
  );
  await expect(
    new SettingsService(repository).update(
      owner,
      "business",
      "rollback-123",
      command(),
      "request-123",
    ),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  for (const name of ["settings", "settings_receipts", "audit_events", "outbox_events"])
    expect(await connection.db!.collection(name).countDocuments()).toBe(0);
});

test("failure appending the required audit rolls back the already-written domain and outbox", async () => {
  const mutationKey = "audit-failure-123";
  const idempotencyKey = `settings:${createHash("sha256").update(`${owner.id}:${mutationKey}`).digest("hex")}`;
  await connection
    .db!.collection("audit_events")
    .insertOne({ idempotencyKey, area: "settings", action: "prior-event" });
  await expect(
    service.update(owner, "business", mutationKey, command(), "request-123"),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  for (const name of ["settings", "settings_receipts", "outbox_events"])
    expect(await connection.db!.collection(name).countDocuments()).toBe(0);
  expect(await connection.db!.collection("audit_events").countDocuments()).toBe(1);
});
test("secrets stay encrypted in rows, absent from all DTOs/events/receipts; blank preserves and enabled clear fails", async () => {
  const values = { ...settingsDefaults("printing"), enabled: true, bridgeId: "test-bridge" };
  const updated = await service.update(
    owner,
    "printing",
    "print-create",
    { revision: 0, values, secrets: { bridgeToken: token } },
    "request-123",
  );
  expect(updated.credentials).toMatchObject({
    configured: true,
    keyId: vault.keyId,
    rotatedAt: clock().toISOString(),
  });
  expect(JSON.stringify(updated)).not.toContain(token);
  expect(JSON.stringify(await service.read(owner, "printing"))).not.toContain(token);
  expect(await service.read(cashier, "printing")).not.toHaveProperty("credentials");
  expect((await service.read(cashier, "printing")).values).not.toHaveProperty("bridgeId");
  const stored = await connection.db!.collection("settings").findOne({ kind: "printing" });
  expect(vault.open("printing", stored!.encryptedPayload)).toEqual({ bridgeToken: token });
  const model = connection.model("SettingsVisibilityTest", settingsSchema);
  expect(await model.findOne({ kind: "printing" }).lean()).not.toHaveProperty("encryptedPayload");
  await service.update(
    owner,
    "printing",
    "print-preserve",
    { revision: 1, values, secrets: { bridgeToken: "" } },
    "request-123",
  );
  expect(
    (await connection.db!.collection("settings").findOne({ kind: "printing" }))!.encryptedPayload,
  ).toBe(stored!.encryptedPayload);
  await expect(
    service.update(
      owner,
      "printing",
      "print-clear-fail",
      { revision: 2, values, secrets: { bridgeToken: null } },
      "request-123",
    ),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  await service.update(
    owner,
    "printing",
    "print-clear-ok",
    { revision: 2, values: { ...values, enabled: false }, secrets: { bridgeToken: null } },
    "request-123",
  );
  expect(
    (await connection.db!.collection("settings").findOne({ kind: "printing" }))!.encryptedPayload,
  ).toBeNull();
  for (const name of ["settings", "settings_receipts", "audit_events", "outbox_events"])
    expect(JSON.stringify(await connection.db!.collection(name).find({}).toArray())).not.toContain(
      token,
    );
});
test("previous keys decrypt, explicit rotation updates key metadata, and old receipts remain replayable", async () => {
  const input = {
    revision: 0,
    values: settingsDefaults("payment"),
    secrets: { gatewayCredential: token },
  };
  await service.update(owner, "payment", "provider-create", input, "request-123");
  const nextVault = new SettingsVault("2".repeat(64), key, clock),
    repository = createSettingsRepository(connection, nextVault, clock),
    next = new SettingsService(repository);
  expect(
    await repository.withCredentials(
      "payment",
      async (_values, secrets) => secrets.gatewayCredential === token,
    ),
  ).toBe(true);
  await expect(
    repository.withCredentials("payment", async () => {
      throw new Error(token);
    }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Settings credential consumer failed" });
  expect(
    await next.update(owner, "payment", "provider-create", input, "request-123"),
  ).toHaveProperty("revision", 1);
  const result = await next.update(
    owner,
    "payment",
    "provider-rotate",
    { revision: 1, values: settingsDefaults("payment"), rotate: true },
    "request-123",
  );
  expect(result.credentials.keyId).toBe(nextVault.keyId);
  const row = await connection.db!.collection("settings").findOne({ kind: "payment" });
  expect(new SettingsVault("2".repeat(64)).open("payment", row!.encryptedPayload)).toEqual({
    gatewayCredential: token,
  });
  expect(
    await connection.db!.collection("audit_events").countDocuments({ action: "settings.rotated" }),
  ).toBe(1);
});
test("independent service caches detect writes from another instance", async () => {
  const other = new SettingsService(createSettingsRepository(connection, vault, clock));
  expect((await other.publicSettings()).business.title).toBe("آرمانی کافه");
  await service.update(owner, "business", "external-write", command(), "request-123");
  expect((await other.publicSettings()).business.title).toBe("کافهٔ تست");
});
test("HTTP checks roles/CSRF before work and returns safe Persian conflicts", async () => {
  const factory = vi.fn(async () => service);
  const handler = (actor: typeof owner | typeof cashier | null) =>
    createSettingsHttpHandler({
      service: factory,
      authenticate: async () => actor,
      origins: () => ["http://localhost:3000"],
    });
  const request = (input: unknown, origin = "http://localhost:3000", key = "http-update-123") =>
    new Request("http://localhost:3000/api/settings/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: origin, "Idempotency-Key": key },
      body: JSON.stringify(input),
    });
  expect((await handler(null)(request(command()), "update", "business")).status).toBe(401);
  expect((await handler(cashier)(request(command()), "update", "business")).status).toBe(403);
  expect(
    (await handler(owner)(request(command(), "https://evil.test"), "update", "business")).status,
  ).toBe(403);
  expect(factory).not.toHaveBeenCalled();
  expect((await handler(owner)(request(command()), "update", "business")).status).toBe(200);
  const conflict = await handler(owner)(
    request(command(), undefined, "http-conflict"),
    "update",
    "business",
  );
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).error.message).toMatch(/[\u0600-\u06ff]/);
  expect(conflict.headers.get("Cache-Control")).toBe("no-store");
  const oversized = await handler(owner)(
    request({ ...command(), padding: "x".repeat(17000) }),
    "update",
    "business",
  );
  expect(oversized.status).toBe(400);
});
test("legacy settings require intentional migration; unknown fields and old credentials abort without data loss", async () => {
  await connection.db!.collection("settings").insertOne({
    kind: "business",
    revision: 0,
    values: { title: "قدیمی" },
    encryptedPayload: null,
  });
  await expect(service.publicSettings()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(await applyMigrations(connection, clock)).toEqual([1, 2, 3, 4]);
  expect((await service.publicSettings()).business.title).toBe("قدیمی");
  await connection.db!.collection("_schema_migrations").deleteOne({ _id: 3 } as never);
  await connection.db!.collection("settings").deleteMany({});
  await connection.db!.collection("settings").insertOne({
    kind: "payment",
    revision: 0,
    values: {},
    encryptedPayload: "legacy-sensitive-payload",
  });
  await expect(applyMigrations(connection, clock)).rejects.toThrow(/operator conversion/);
  expect(
    (await connection.db!.collection("settings").findOne({ kind: "payment" }))!.encryptedPayload,
  ).toBe("legacy-sensitive-payload");
});
