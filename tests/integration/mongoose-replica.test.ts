import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Schema } from "mongoose";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import { recordRejectedSensitiveAction } from "../../src/modules/audit/server.ts";
import { finishOutbox } from "../../src/modules/notifications/infrastructure/repository.ts";
import {
  commitSensitiveChange,
  outboxModel,
  OutboxWorker,
  replayOutbox,
} from "../../src/modules/notifications/server.ts";
import {
  documentSchemaOptions,
  iranianMobileField,
  tomanAmountField,
} from "../../src/server/database/conventions.ts";
import { mapDuplicateKey } from "../../src/server/database/errors.ts";
import { applyDatabaseIndexes, databaseIndexes } from "../../src/server/database/operations.ts";
import { applyPagination } from "../../src/server/database/pagination.ts";
import { testEnv } from "../fixtures/config.mjs";
import { customerFactory, isolatedResources, sequentialObjectIds } from "../fixtures/isolation.ts";

const resources = isolatedResources("mongoose");
let replica: MongoMemoryReplSet | undefined;
let connection: mongoose.Connection | undefined;

beforeAll(async () => {
  Object.assign(process.env, testEnv());
  const installedWindowsBinary = "C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe";
  const systemBinary =
    process.env.MONGOMS_SYSTEM_BINARY ||
    (process.platform === "win32" && existsSync(installedWindowsBinary)
      ? installedWindowsBinary
      : undefined);
  const installedVersion = systemBinary
    ? /db version v(\d+\.\d+\.\d+)/.exec(
        execFileSync(systemBinary, ["--version"], { encoding: "utf8", timeout: 5000 }),
      )?.[1]
    : undefined;
  replica = await MongoMemoryReplSet.create({
    binary: systemBinary
      ? { systemBinary, ...(installedVersion ? { version: installedVersion } : {}) }
      : undefined,
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replica.getUri(resources.databaseName);
  connection = mongoose.createConnection(uri, {
    autoCreate: false,
    autoIndex: false,
    bufferCommands: false,
  });
  await connection.asPromise();
}, 300_000);

afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  await replica?.stop();
});

test("real replica-set transaction commits and unique phone index maps to conflict", async () => {
  if (!connection) throw new Error("Isolated MongoDB connection was not started");
  const schema = new Schema(
    {
      name: { type: String, required: true },
      phone: iranianMobileField(),
      amountToman: tomanAmountField(),
    },
    documentSchemaOptions(true),
  );
  schema.index({ phone: 1 }, { unique: true, name: "test_phone_unique" });
  const Customer = connection.model("HarnessCustomer", schema);
  await Customer.createCollection();
  await Customer.createIndexes();

  await connection.transaction(async (session) => {
    const record = new Customer({ ...customerFactory(), amountToman: 2500 });
    await record.save({ session });
  });
  const query = Customer.find().sort({ _id: 1 });
  const { query: page, pagination } = applyPagination(query, 1, 1);
  expect(pagination.skip).toBe(0);
  expect((await page.exec())[0].phone).toBe("+989123456789");

  const nextId = sequentialObjectIds(2);
  try {
    await new Customer({ ...customerFactory({ _id: nextId() }), amountToman: 3000 }).save();
    throw new Error("Expected the unique phone index to reject a duplicate");
  } catch (error) {
    expect(mapDuplicateKey(error)?.code).toBe("CONFLICT");
  }
  expect(await Customer.countDocuments()).toBe(1);
}, 120_000);

function operationDraft(id: string) {
  const requestId = randomUUID();
  const actor = { kind: "admin" as const, id: "000000000000000000000001" };
  return {
    audit: {
      area: "order" as const,
      action: "order.placed",
      actor,
      subject: { kind: "order", id },
      requestId,
      idempotencyKey: `audit-${id}`,
    },
    events: [
      {
        aggregateKind: "order",
        aggregateId: id,
        eventType: "order.placed",
        payload: { orderId: id },
        requestId,
        actor,
        idempotencyKey: `event-${id}`,
      },
    ] as const,
  };
}

test("sensitive changes, audit, and outbox commit atomically or all roll back", async () => {
  if (!connection?.db) throw new Error("Isolated MongoDB connection was not started");
  const db = connection.db;
  await db.createCollection("_outbox_domain_test");
  const changes = db.collection<{ _id: string; state?: string }>("_outbox_domain_test");
  const id = randomUUID();
  const draft = operationDraft(id);
  await commitSensitiveChange(connection, {
    ...draft,
    change: async (session) => {
      await changes.insertOne({ _id: id, state: "placed" }, { session });
      return id;
    },
  });
  expect(await changes.findOne({ _id: id })).not.toBeNull();
  expect(
    await db.collection("outbox_events").countDocuments({ idempotencyKey: `event-${id}` }),
  ).toBe(1);
  expect(
    await db.collection("audit_events").countDocuments({ idempotencyKey: `audit-${id}` }),
  ).toBe(1);

  const rollbackId = randomUUID();
  await expect(
    commitSensitiveChange(connection, {
      ...operationDraft(rollbackId),
      change: async (session) => {
        await changes.insertOne({ _id: rollbackId, state: "placed" }, { session });
        throw new Error("rollback requested");
      },
    }),
  ).rejects.toThrow("rollback requested");
  expect(await changes.findOne({ _id: rollbackId })).toBeNull();
  expect(await db.collection("outbox_events").countDocuments({ aggregateId: rollbackId })).toBe(0);
  expect(await db.collection("audit_events").countDocuments({ "subject.id": rollbackId })).toBe(0);

  const invalidId = randomUUID();
  const invalid = operationDraft(invalidId);
  await expect(
    commitSensitiveChange(connection, {
      ...invalid,
      events: [{ ...invalid.events[0], payload: { paymentToken: "secret" } }],
      change: async (session) => {
        await changes.insertOne({ _id: invalidId }, { session });
      },
    }),
  ).rejects.toThrow();
  expect(await changes.findOne({ _id: invalidId })).toBeNull();

  const missingId = randomUUID();
  let invoked = false;
  await expect(
    commitSensitiveChange(connection, {
      ...operationDraft(missingId),
      events: [],
      change: async () => {
        invoked = true;
      },
    } as never),
  ).rejects.toThrow(/at least one outbox event/);
  expect(invoked).toBe(false);

  await expect(
    connection.models.AuditEvent.updateOne(
      { idempotencyKey: `audit-${id}` },
      { $set: { action: "rewritten" } },
    ),
  ).rejects.toThrow(/append-only/);
  await recordRejectedSensitiveAction(connection, {
    ...operationDraft(randomUUID()).audit,
    action: "order.denied",
  });
  expect(
    await db
      .collection("audit_events")
      .countDocuments({ action: "order.denied", outcome: "failure" }),
  ).toBe(1);
}, 120_000);

test("leases prevent simultaneous claims and stale claim tokens cannot finish", async () => {
  if (!connection) throw new Error("Isolated MongoDB connection was not started");
  await outboxModel(connection).deleteMany({});
  const id = randomUUID();
  await commitSensitiveChange(connection, { ...operationDraft(id), change: async () => undefined });
  expect(await new OutboxWorker(connection, {}, { workerId: "idle" }).runOnce()).toBe(false);
  expect(
    (
      await outboxModel(connection)
        .findOne({ idempotencyKey: `event-${id}` })
        .lean()
    )?.status,
  ).toBe("pending");
  let release!: () => void;
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let effects = 0;
  const handler = async () => {
    started();
    await running;
    effects += 1;
  };
  const first = new OutboxWorker(
    connection,
    { "order.placed": handler },
    { workerId: "worker-a", leaseMs: 5000, handlerTimeoutMs: 4000 },
  );
  const second = new OutboxWorker(
    connection,
    { "order.placed": handler },
    { workerId: "worker-b", leaseMs: 5000, handlerTimeoutMs: 4000 },
  );
  const firstRun = first.runOnce();
  await entered;
  const active = await outboxModel(connection)
    .findOne({ idempotencyKey: `event-${id}` })
    .lean();
  expect(
    await finishOutbox(
      connection,
      {
        id: String(active?._id),
        claimToken: "stale-token",
        eventType: "order.placed",
        payload: {},
        aggregateKind: "order",
        aggregateId: id,
        requestId: String(active?.requestId),
        actor: { kind: "admin", id: "000000000000000000000001" },
        idempotencyKey: `event-${id}`,
        attempts: 1,
        maxAttempts: 8,
      },
      new Date(),
    ),
  ).toBe(false);
  expect(await second.runOnce()).toBe(false);
  release();
  await firstRun;
  expect(effects).toBe(1);
  expect(
    (
      await outboxModel(connection)
        .findOne({ idempotencyKey: `event-${id}` })
        .lean()
    )?.status,
  ).toBe("delivered");
}, 120_000);

test("retry, poison, replay, stable delivery key, and log redaction", async () => {
  if (!connection) throw new Error("Isolated MongoDB connection was not started");
  await outboxModel(connection).deleteMany({});
  const id = randomUUID();
  await commitSensitiveChange(connection, { ...operationDraft(id), change: async () => undefined });
  await outboxModel(connection).updateOne(
    { idempotencyKey: `event-${id}` },
    { $set: { maxAttempts: 2 } },
  );
  let clock = new Date("2026-09-27T12:00:00.000Z");
  await outboxModel(connection).updateOne(
    { idempotencyKey: `event-${id}` },
    { $set: { availableAt: clock } },
  );
  const lines: string[] = [];
  const output = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  try {
    const failing = new OutboxWorker(
      connection,
      {
        "order.placed": async () => {
          throw new Error("Provider leaked test_secret_key_never_use_in_deployment");
        },
      },
      { workerId: "worker-fail", now: () => clock, random: () => 0.5 },
    );
    expect(await failing.runOnce()).toBe(true);
    let event = await outboxModel(connection)
      .findOne({ idempotencyKey: `event-${id}` })
      .lean();
    expect(event?.status).toBe("pending");
    expect(event?.attempts).toBe(1);
    expect(event?.lastFailureCode).toBe("HANDLER_FAILED");
    expect(JSON.stringify(event)).not.toContain("test_secret_key_never_use_in_deployment");
    clock = new Date(clock.getTime() + 1001);
    expect(await failing.runOnce()).toBe(true);
    event = await outboxModel(connection)
      .findOne({ idempotencyKey: `event-${id}` })
      .lean();
    expect(event?.status).toBe("dead");
    expect(event?.attempts).toBe(2);
  } finally {
    output.mockRestore();
  }
  expect(lines.join("")).not.toContain("test_secret_key_never_use_in_deployment");
  expect(lines.join("")).toContain("[REDACTED]");

  const dead = await outboxModel(connection)
    .findOne({ idempotencyKey: `event-${id}` })
    .lean();
  expect(await replayOutbox(connection, String(dead?._id), clock)).toBe(true);
  const seen = new Set<string>();
  let effects = 0;
  const recovered = new OutboxWorker(
    connection,
    {
      "order.placed": async (event) => {
        if (!seen.has(event.idempotencyKey)) {
          seen.add(event.idempotencyKey);
          effects += 1;
        }
      },
    },
    { workerId: "worker-replay", now: () => clock },
  );
  expect(await recovered.runOnce()).toBe(true);
  expect(await replayOutbox(connection, String(dead?._id), clock)).toBe(true);
  expect(await recovered.runOnce()).toBe(true);
  expect(effects).toBe(1);
  expect((await outboxModel(connection).findOne({ _id: dead?._id }).lean())?.replayCount).toBe(2);
}, 120_000);

test("declared business indexes apply explicitly to an isolated replica set", async () => {
  if (!connection?.db) throw new Error("Isolated MongoDB connection was not started");
  await applyDatabaseIndexes(connection);
  const indexes = await connection.db.collection("outbox_events").listIndexes().toArray();
  expect(indexes.some((index) => index.name === "outbox_claim")).toBe(true);
  expect(indexes.some((index) => index.name === "outbox_idempotency_unique" && index.unique)).toBe(
    true,
  );
  expect(databaseIndexes.length).toBeGreaterThan(45);
}, 120_000);
