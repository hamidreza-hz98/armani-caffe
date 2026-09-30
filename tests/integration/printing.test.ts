import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { WebSocket } from "ws";

import type { ClaimedOutbox } from "@/modules/notifications/server";
import { MongoPrintJobs } from "@/modules/printing/server";
import { printOutboxHandlers } from "@/server/commerce/print-outbox";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";
import type { PrintSchedule } from "@/server/queue";
import { PrintDispatcher } from "@/server/queue";
import { startPrintRealtime } from "@/server/realtime";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";

class MemorySchedule implements PrintSchedule {
  dueJobs = new Map<string, number>();
  presence = new Map<string, string>();
  async schedule(id: string, at: Date) {
    this.dueJobs.set(id, at.getTime());
  }
  async due(now: Date, limit: number) {
    return [...this.dueJobs]
      .filter(([, at]) => at <= now.getTime())
      .slice(0, limit)
      .map(([id]) => id);
  }
  async remove(id: string) {
    this.dueJobs.delete(id);
  }
  async acquirePresence(id: string, instance: string) {
    if (this.presence.has(id)) return false;
    this.presence.set(id, instance);
    return true;
  }
  async refreshPresence(id: string, instance: string) {
    return this.presence.get(id) === instance;
  }
  async releasePresence(id: string, instance: string) {
    if (this.presence.get(id) === instance) this.presence.delete(id);
  }
  async ping() {}
  async close() {}
}
let replica: MongoMemoryReplSet,
  connection: mongoose.Connection,
  jobs: MongoPrintJobs,
  schedule: MemorySchedule;
let time = new Date("2026-01-01T00:00:00.000Z");
const now = () => new Date(time),
  invoiceId = new mongoose.Types.ObjectId(),
  orderId = new mongoose.Types.ObjectId(),
  reprintId = new mongoose.Types.ObjectId();
const event = (kind: "invoice.issued" | "invoice.reprint_requested"): ClaimedOutbox => ({
  id: new mongoose.Types.ObjectId().toString(),
  claimToken: "claim",
  eventType: kind,
  payload: {
    invoiceId: invoiceId.toString(),
    orderId: orderId.toString(),
    ...(kind === "invoice.reprint_requested" ? { reprintId: reprintId.toString() } : {}),
  },
  aggregateKind: "invoice",
  aggregateId: invoiceId.toString(),
  requestId: "test",
  actor: { kind: "system", id: null },
  idempotencyKey: kind,
  attempts: 1,
  maxAttempts: 8,
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
    .createConnection(replica.getUri(isolatedResources("printing").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
  await applyMigrations(connection, now);
});
beforeEach(async () => {
  time = new Date("2026-01-01T00:00:00.000Z");
  schedule = new MemorySchedule();
  jobs = new MongoPrintJobs(connection, now, () => 0.5);
  for (const name of ["print_jobs", "invoices", "invoice_reprints"])
    await connection.db!.collection(name).deleteMany({});
  await connection.db!.collection("invoices").insertOne({
    _id: invoiceId,
    orderId,
    paperWidthMm: 58,
    printing: { automatic: true, printerId: "test-bridge" },
  });
  await connection
    .db!.collection("invoice_reprints")
    .insertOne({ _id: reprintId, invoiceId, orderId, paperWidthMm: 80 });
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  if (replica) await replica.stop();
});

test("invoice outbox deduplicates automatic jobs and links a new reprint attempt", async () => {
  const handlers = printOutboxHandlers(connection, schedule, "fallback", now);
  await handlers["invoice.issued"](event("invoice.issued"));
  await handlers["invoice.issued"](event("invoice.issued"));
  const automatic = await jobs.byOrder(orderId.toString());
  expect(automatic).toHaveLength(1);
  expect(automatic[0]).toMatchObject({
    source: "automatic",
    printerId: "test-bridge",
    paperWidthMm: 58,
    status: "queued",
  });
  expect(schedule.dueJobs.size).toBe(1);
  await handlers["invoice.reprint_requested"](event("invoice.reprint_requested"));
  await handlers["invoice.reprint_requested"](event("invoice.reprint_requested"));
  expect(await jobs.byOrder(orderId.toString())).toMatchObject([
    { source: "automatic" },
    { source: "reprint", reprintId: reprintId.toString(), paperWidthMm: 80 },
  ]);
  expect(schedule.dueJobs.size).toBe(2);
});

test("socket delivery is not success; matching ACK succeeds once and stale ACK is rejected", async () => {
  await printOutboxHandlers(connection, schedule, "fallback", now)["invoice.issued"](
    event("invoice.issued"),
  );
  const delivered: string[] = [];
  const dispatcher = new PrintDispatcher(
    jobs,
    schedule,
    async (job) => {
      delivered.push(job.id);
      return true;
    },
    () => true,
    now,
    1000,
  );
  await dispatcher.runOnce();
  const [claimed] = await jobs.byOrder(orderId.toString());
  expect(claimed.status).toBe("printing");
  expect(claimed.attempts).toBe(1);
  expect(delivered).toEqual([claimed.id]);
  const ack = {
    jobId: claimed.id,
    printerId: claimed.printerId,
    attempt: 1,
    deliveryId: claimed.deliveryId!,
    result: "printed" as const,
    at: now().toISOString(),
  };
  await expect(jobs.acknowledge({ ...ack, attempt: 2 })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect((await jobs.acknowledge(ack)).status).toBe("printed");
  expect((await jobs.acknowledge(ack)).status).toBe("printed");
  expect((await jobs.byOrder(orderId.toString()))[0].attempts).toBe(1);
});

test("lost ACK and process/Redis restart reconcile one leased job for bounded redelivery", async () => {
  await printOutboxHandlers(connection, schedule, "fallback", now)["invoice.issued"](
    event("invoice.issued"),
  );
  const first = new PrintDispatcher(
    jobs,
    schedule,
    async () => true,
    () => true,
    now,
    1000,
  );
  await first.runOnce();
  const initial = (await jobs.byOrder(orderId.toString()))[0];
  schedule = new MemorySchedule(); // New process with an empty Redis schedule.
  time = new Date(time.getTime() + 1001);
  const next = new PrintDispatcher(
    jobs,
    schedule,
    async () => true,
    () => true,
    now,
    1000,
  );
  await next.reconcile();
  const recovered = (await jobs.byOrder(orderId.toString()))[0];
  expect(recovered.status).toBe("queued");
  expect(recovered.lastFailureCode).toBe("ACK_TIMEOUT");
  expect(schedule.dueJobs.has(initial.id)).toBe(true);
  time = new Date(time.getTime() + 2000);
  await next.runOnce();
  expect((await jobs.byOrder(orderId.toString()))[0]).toMatchObject({
    status: "printing",
    attempts: 2,
  });
  await expect(
    jobs.acknowledge({
      jobId: initial.id,
      printerId: initial.printerId,
      attempt: 1,
      deliveryId: initial.deliveryId!,
      result: "printed",
      at: now().toISOString(),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("printer errors retry and the fifth failed ACK dead-letters the job", async () => {
  await printOutboxHandlers(connection, schedule, "fallback", now)["invoice.issued"](
    event("invoice.issued"),
  );
  for (let attempt = 1; attempt <= 5; attempt++) {
    const dispatcher = new PrintDispatcher(
      jobs,
      schedule,
      async () => true,
      () => true,
      now,
      1000,
    );
    await dispatcher.runOnce();
    const current = (await jobs.byOrder(orderId.toString()))[0];
    expect(current.attempts).toBe(attempt);
    const acknowledgment = {
      jobId: current.id,
      printerId: current.printerId,
      attempt,
      deliveryId: current.deliveryId!,
      result: "error" as const,
      errorCode: "PAPER_OUT",
      at: now().toISOString(),
    };
    const result = await jobs.acknowledge(acknowledgment);
    expect(result.status).toBe(attempt === 5 ? "dead" : "queued");
    expect(await jobs.acknowledge(acknowledgment)).toEqual(result);
    if (result.nextAttemptAt) {
      await schedule.schedule(result.id, new Date(result.nextAttemptAt));
      time = new Date(new Date(result.nextAttemptAt).getTime() + 1);
    }
  }
  expect(schedule.dueJobs.size).toBe(0);
});

test("only one bridge instance registers a printer; reconnect after close and ACK is authoritative", async () => {
  await printOutboxHandlers(connection, schedule, "fallback", now)["invoice.issued"](
    event("invoice.issued"),
  );
  const server = await startPrintRealtime({
    port: 0,
    path: "/ws",
    heartbeatMs: 1000,
    origins: ["https://caffe.example"],
    authorizeBridge: async (printerId, token) =>
      printerId === "test-bridge" && token === "test_printer_bridge_token_32_characters",
    schedule,
    jobs,
    authenticateAdmin: async () => false,
    payload: async (job) => ({
      jobId: job.id,
      printerId: job.printerId,
      attempt: job.attempts,
      deliveryId: job.deliveryId,
    }),
    now,
  });
  const connect = (instanceId: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=bridge`);
      ws.once("open", () => {
        ws.send(
          JSON.stringify({
            v: 1,
            type: "register",
            printerId: "test-bridge",
            token: "test_printer_bridge_token_32_characters",
            instanceId,
          }),
        );
        resolve(ws);
      });
      ws.once("error", reject);
    });
  try {
    const first = await connect("instance-one");
    const registered = await new Promise<unknown>((resolve) =>
      first.once("message", (data) => resolve(JSON.parse(data.toString()))),
    );
    expect(registered).toMatchObject({ type: "registered", printerId: "test-bridge" });
    const heartbeat = new Promise<Record<string, unknown>>((resolve) =>
      first.once("message", (data) => resolve(JSON.parse(data.toString()))),
    );
    first.send(JSON.stringify({ v: 1, type: "heartbeat", at: now().toISOString() }));
    expect(await heartbeat).toMatchObject({ type: "heartbeat.ack" });
    const second = await connect("instance-two");
    await new Promise<void>((resolve) => second.once("close", () => resolve()));
    expect(server.available("test-bridge")).toBe(true);
    const dispatcher = new PrintDispatcher(
      jobs,
      schedule,
      server.deliver,
      server.available,
      now,
      5000,
    );
    const message = new Promise<Record<string, unknown>>((resolve) =>
      first.once("message", (data) => resolve(JSON.parse(data.toString()))),
    );
    await dispatcher.runOnce();
    const delivery = await message;
    expect(delivery.type).toBe("print.job");
    expect((await jobs.byOrder(orderId.toString()))[0].status).toBe("printing");
    first.send(
      JSON.stringify({
        v: 1,
        type: "ack",
        jobId: delivery.jobId,
        printerId: "test-bridge",
        attempt: delivery.attempt,
        deliveryId: delivery.deliveryId,
        result: "printed",
        at: now().toISOString(),
      }),
    );
    await new Promise<unknown>((resolve) => first.once("message", (data) => resolve(data)));
    expect((await jobs.byOrder(orderId.toString()))[0].status).toBe("printed");
    first.close();
    await new Promise<void>((resolve) => first.once("close", () => resolve()));
    const replacement = await connect("instance-three");
    await new Promise<unknown>((resolve) => replacement.once("message", (data) => resolve(data)));
    replacement.close();
  } finally {
    await server.close();
  }
});

test("admin WebSocket uses an authenticated fixed room and rejects client room commands", async () => {
  const server = await startPrintRealtime({
    port: 0,
    path: "/ws",
    heartbeatMs: 1000,
    origins: ["https://caffe.example"],
    authorizeBridge: async () => false,
    schedule,
    jobs,
    authenticateAdmin: async (cookie) => cookie === "admin_cookie=valid",
    payload: async () => ({}),
    now,
  });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=admin`, {
      headers: { Origin: "https://caffe.example", Cookie: "admin_cookie=valid" },
    });
    const ready = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.once("message", (data) => resolve(JSON.parse(data.toString())));
      ws.once("error", reject);
    });
    expect(ready).toMatchObject({ type: "admin.ready", room: "tenant:default:print" });
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    ws.send(JSON.stringify({ type: "join", room: "tenant:other:print" }));
    expect(await closed).toBe(1008);
    const rejected = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=admin`, {
      headers: { Origin: "https://evil.example", Cookie: "admin_cookie=valid" },
    });
    await new Promise<void>((resolve) => rejected.once("error", () => resolve()));
  } finally {
    await server.close();
  }
});
