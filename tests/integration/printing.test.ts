import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { WebSocket } from "ws";

import { makeIssuedInvoice, renderInvoiceHtml } from "@/modules/invoices";
import type { ClaimedOutbox } from "@/modules/notifications/server";
import { MongoPrintJobs } from "@/modules/printing/server";
import { receiptFontDataUrl } from "@/server/commerce/invoice-font";
import { printOutboxHandlers } from "@/server/commerce/print-outbox";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";
import type { PrintSchedule } from "@/server/queue";
import { PrintDispatcher } from "@/server/queue";
import { startPrintRealtime } from "@/server/realtime";

import { FilePrinter } from "../../bridge/adapters.ts";
import { PrintBridge } from "../../bridge/client.ts";
import { ReceiptRenderer } from "../../bridge/receipt.ts";
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

test("dispatcher survives a temporary Redis schedule error and resumes polling", async () => {
  const flaky = new MemorySchedule();
  const controller = new AbortController();
  let calls = 0;
  flaky.due = async () => {
    calls += 1;
    if (calls === 1) throw new Error("Redis temporarily unavailable");
    controller.abort();
    return [];
  };
  const dispatcher = new PrintDispatcher(
    jobs,
    flaky,
    async () => true,
    () => true,
    now,
  );
  await dispatcher.run(controller.signal);
  expect(calls).toBe(2);
});

test("realtime liveness stays up while queue readiness drops and recovers", async () => {
  const unstable = new MemorySchedule();
  let queueUp = true;
  unstable.ping = async () => {
    if (!queueUp) throw new Error("Redis down");
  };
  const server = await startPrintRealtime({
    port: 0,
    path: "/ws",
    heartbeatMs: 1000,
    origins: [],
    authorizeBridge: async () => false,
    schedule: unstable,
    jobs,
    authenticateAdmin: async () => false,
    payload: async () => ({}),
  });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${origin}/ready`)).status).toBe(200);
    queueUp = false;
    expect((await fetch(`${origin}/live`)).status).toBe(200);
    expect((await fetch(`${origin}/ready`)).status).toBe(503);
    queueUp = true;
    expect((await fetch(`${origin}/ready`)).status).toBe(200);
  } finally {
    await server.close();
  }
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

test("Redis scheduling interruption leaves the Mongo job recoverable after queue reconciliation", async () => {
  const healthy = schedule;
  const interrupted = new MemorySchedule();
  interrupted.schedule = async () => {
    throw new Error("REDIS_UNAVAILABLE");
  };
  await expect(
    printOutboxHandlers(connection, interrupted, "fallback", now)["invoice.issued"](
      event("invoice.issued"),
    ),
  ).rejects.toThrow("REDIS_UNAVAILABLE");
  const [queued] = await jobs.byOrder(orderId.toString());
  expect(queued.status).toBe("queued");
  expect(healthy.dueJobs.size).toBe(0);
  // Replaying the same outbox event cannot create a second automatic job.
  await printOutboxHandlers(connection, healthy, "fallback", now)["invoice.issued"](
    event("invoice.issued"),
  );
  const dispatcher = new PrintDispatcher(
    jobs,
    healthy,
    async () => true,
    () => true,
    now,
    1000,
  );
  await dispatcher.reconcile();
  expect(healthy.dueJobs.has(queued.id)).toBe(true);
  await dispatcher.runOnce();
  expect(await jobs.byOrder(orderId.toString())).toMatchObject([
    { id: queued.id, status: "printing", attempts: 1 },
  ]);
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
  const [dead] = await jobs.byOrder(orderId.toString());
  expect(dead).toMatchObject({ source: "automatic", status: "dead", lastFailureCode: "PAPER_OUT" });
  await printOutboxHandlers(connection, schedule, "fallback", now)["invoice.reprint_requested"](
    event("invoice.reprint_requested"),
  );
  expect(await jobs.byOrder(orderId.toString())).toMatchObject([
    { id: dead.id, status: "dead" },
    { source: "reprint", status: "queued", reprintId: reprintId.toString() },
  ]);
  expect(await connection.db!.collection("invoices").countDocuments({})).toBe(1);
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

test("slow printer, socket loss, lost ACK and bridge restart produce one adapter output", async () => {
  const path = await mkdtemp(join(tmpdir(), "armani-lost-print-ack-"));
  const liveJobs = new MongoPrintJobs(connection);
  await printOutboxHandlers(connection, schedule, "fallback")["invoice.issued"](
    event("invoice.issued"),
  );
  let prints = 0;
  let release!: () => void;
  let began!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (began = resolve));
  const file = new FilePrinter(join(path, "receipts"));
  const adapter = {
    async print(bytes: Uint8Array, delivery: import("../../bridge/protocol.ts").PrintDelivery) {
      prints++;
      began();
      await gate;
      await file.print(bytes, delivery);
    },
  };
  const serve = () =>
    startPrintRealtime({
      port: 0,
      path: "/ws",
      heartbeatMs: 1000,
      origins: [],
      authorizeBridge: async (printerId, token) =>
        printerId === "test-bridge" && token === "test_printer_bridge_token_32_characters",
      schedule,
      jobs: liveJobs,
      authenticateAdmin: async () => false,
      payload: async (job) => ({
        jobId: job.id,
        invoiceId: job.invoiceId,
        printerId: job.printerId,
        attempt: job.attempts,
        deliveryId: job.deliveryId,
        paperWidthMm: job.paperWidthMm,
        html: '<!doctype html><html lang="fa" dir="rtl"><style>data:font/woff2;base64,AAAA</style></html>',
      }),
    });
  const makeBridge = (port: number) =>
    new PrintBridge(
      {
        url: `ws://127.0.0.1:${port}/ws?role=bridge`,
        printerId: "test-bridge",
        token: "test_printer_bridge_token_32_characters",
        journalDirectory: join(path, "journal"),
      },
      adapter,
      async () => Uint8Array.from([27, 64, 10]),
      () => undefined,
    );
  let server = await serve();
  let serverClosed = false;
  const first = makeBridge(server.port);
  const firstAbort = new AbortController();
  const firstRun = first.run(firstAbort.signal);
  try {
    for (let i = 0; i < 100 && !server.available("test-bridge"); i++) await delay(50);
    expect(server.available("test-bridge")).toBe(true);
    await new PrintDispatcher(
      liveJobs,
      schedule,
      server.deliver,
      server.available,
      undefined,
      1000,
    ).runOnce();
    await started;
    const [job] = await liveJobs.byOrder(orderId.toString());
    expect(job.status).toBe("printing");
    expect(await first.journal.read(job.id)).toMatchObject({ state: "received" });
    await server.close();
    serverClosed = true;
    release();
    for (let i = 0; i < 100 && (await first.journal.read(job.id))?.state !== "printed"; i++)
      await delay(20);
    expect(await first.journal.read(job.id)).toMatchObject({ state: "printed" });
    expect((await liveJobs.get(job.id))?.status).toBe("printing");
    firstAbort.abort();
    await firstRun;
    await delay(1100);
    server = await serve();
    serverClosed = false;
    const restarted = makeBridge(server.port);
    const nextAbort = new AbortController();
    const nextRun = restarted.run(nextAbort.signal);
    try {
      for (let i = 0; i < 100 && !server.available("test-bridge"); i++) await delay(50);
      expect(server.available("test-bridge")).toBe(true);
      const dispatcher = new PrintDispatcher(
        liveJobs,
        schedule,
        server.deliver,
        server.available,
        undefined,
        1000,
      );
      await dispatcher.reconcile();
      for (let i = 0; i < 100 && (await liveJobs.get(job.id))?.status !== "printed"; i++) {
        await dispatcher.runOnce();
        await delay(50);
      }
      expect(await liveJobs.get(job.id)).toMatchObject({ status: "printed", attempts: 2 });
      expect((await restarted.journal.read(job.id))?.state).toMatch(/printed|acknowledged/u);
      expect(prints).toBe(1);
      expect(await readFile(join(path, "receipts", `${job.id}.escpos`))).toEqual(
        Buffer.from([27, 64, 10]),
      );
    } finally {
      nextAbort.abort();
      await nextRun;
    }
  } finally {
    release();
    firstAbort.abort();
    await firstRun.catch(() => undefined);
    if (!serverClosed) await server.close();
    await rm(path, { recursive: true, force: true });
  }
});

test("malformed server job is rejected before printing and a corrected retry succeeds", async () => {
  const path = await mkdtemp(join(tmpdir(), "armani-malformed-print-"));
  const liveJobs = new MongoPrintJobs(connection);
  await printOutboxHandlers(connection, schedule, "fallback")["invoice.issued"](
    event("invoice.issued"),
  );
  let malformed = true;
  let prints = 0;
  const logs: string[] = [];
  const server = await startPrintRealtime({
    port: 0,
    path: "/ws",
    heartbeatMs: 1000,
    origins: [],
    authorizeBridge: async (printerId, token) =>
      printerId === "test-bridge" && token === "test_printer_bridge_token_32_characters",
    schedule,
    jobs: liveJobs,
    authenticateAdmin: async () => false,
    payload: async (job) => ({
      jobId: job.id,
      invoiceId: job.invoiceId,
      printerId: job.printerId,
      attempt: job.attempts,
      deliveryId: job.deliveryId,
      paperWidthMm: job.paperWidthMm,
      html: malformed
        ? "<script>invalid</script>"
        : '<!doctype html><html lang="fa" dir="rtl"><style>data:font/woff2;base64,AAAA</style></html>',
    }),
  });
  const controller = new AbortController();
  const bridge = new PrintBridge(
    {
      url: `ws://127.0.0.1:${server.port}/ws?role=bridge`,
      printerId: "test-bridge",
      token: "test_printer_bridge_token_32_characters",
      journalDirectory: join(path, "journal"),
    },
    {
      async print() {
        prints++;
      },
    },
    async () => Uint8Array.from([27, 64, 10]),
    (name) => logs.push(name),
  );
  const running = bridge.run(controller.signal);
  try {
    for (let i = 0; i < 100 && !server.available("test-bridge"); i++) await delay(50);
    expect(server.available("test-bridge")).toBe(true);
    const dispatcher = new PrintDispatcher(
      liveJobs,
      schedule,
      server.deliver,
      server.available,
      undefined,
      1000,
    );
    await dispatcher.runOnce();
    const [job] = await liveJobs.byOrder(orderId.toString());
    for (let i = 0; i < 100 && !logs.includes("protocol_error"); i++) await delay(20);
    expect(logs).toContain("protocol_error");
    expect(prints).toBe(0);
    expect(await bridge.journal.read(job.id)).toBeNull();
    expect((await liveJobs.get(job.id))?.status).toBe("printing");
    await delay(1100);
    await dispatcher.reconcile();
    expect(await liveJobs.get(job.id)).toMatchObject({
      status: "queued",
      lastFailureCode: "ACK_TIMEOUT",
    });
    malformed = false;
    for (let i = 0; i < 100 && !server.available("test-bridge"); i++) await delay(50);
    expect(server.available("test-bridge")).toBe(true);
    for (let i = 0; i < 100 && (await liveJobs.get(job.id))?.status !== "printed"; i++) {
      await dispatcher.runOnce();
      await delay(50);
    }
    expect(await liveJobs.get(job.id)).toMatchObject({ status: "printed", attempts: 2 });
    expect(prints).toBe(1);
  } finally {
    controller.abort();
    await running;
    await server.close();
    await rm(path, { recursive: true, force: true });
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

test("orders room is separately authorized, read-only, and broadcasts identity-only hints", async () => {
  const server = await startPrintRealtime({
    port: 0,
    path: "/ws",
    heartbeatMs: 1000,
    origins: ["https://caffe.example"],
    authorizeBridge: async () => false,
    schedule,
    jobs,
    authenticateAdmin: async () => false,
    authenticateOrders: async (cookie) => cookie === "admin_cookie=orders",
    payload: async () => ({}),
    now,
  });
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=orders`, {
      headers: { Origin: "https://caffe.example", Cookie: "admin_cookie=orders" },
    });
    const message = () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        socket.once("message", (data) => resolve(JSON.parse(data.toString())));
        socket.once("error", reject);
      });
    expect(await message()).toMatchObject({ type: "orders.ready", room: "tenant:default:orders" });
    const notice = message();
    server.broadcastOrder({
      eventId: "a".repeat(24),
      orderId: "b".repeat(24),
      change: "order.confirmed",
      at: now().toISOString(),
    });
    expect(await notice).toEqual({
      v: 1,
      type: "order.changed",
      eventId: "a".repeat(24),
      orderId: "b".repeat(24),
      change: "order.confirmed",
      at: now().toISOString(),
    });
    const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));
    socket.send(JSON.stringify({ type: "join", room: "tenant:other:orders" }));
    expect(await closed).toBe(1008);
    const rejected = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=orders`, {
      headers: { Origin: "https://caffe.example", Cookie: "admin_cookie=invalid" },
    });
    await new Promise<void>((resolve) => rejected.once("error", () => resolve()));
  } finally {
    await server.close();
  }
});

test("print room reports bridge presence and clears it after disconnect", async () => {
  const server = await startPrintRealtime({
    port: 0,
    path: "/ws",
    heartbeatMs: 1000,
    origins: ["https://caffe.example"],
    authorizeBridge: async (printerId, token) =>
      printerId === "test-bridge" && token === "test_bridge_secret_32_characters_long",
    schedule,
    jobs,
    authenticateAdmin: async (cookie) => cookie === "admin_cookie=valid",
    payload: async () => ({}),
    now,
  });
  const admin = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=admin`, {
    headers: { Origin: "https://caffe.example", Cookie: "admin_cookie=valid" },
  });
  const read = (socket: WebSocket) =>
    new Promise<Record<string, unknown>>((resolve) =>
      socket.once("message", (bytes) => resolve(JSON.parse(bytes.toString()))),
    );
  let bridge: WebSocket | null = null;
  try {
    expect(await read(admin)).toMatchObject({ type: "admin.ready" });
    const online = read(admin);
    bridge = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=bridge`);
    await new Promise<void>((resolve) => bridge!.once("open", resolve));
    bridge.send(
      JSON.stringify({
        v: 1,
        type: "register",
        printerId: "test-bridge",
        token: "test_bridge_secret_32_characters_long",
        instanceId: "instance-one",
      }),
    );
    expect(await online).toMatchObject({
      type: "bridge.presence",
      printerId: "test-bridge",
      online: true,
    });
    const offline = read(admin);
    bridge.close();
    expect(await offline).toMatchObject({
      type: "bridge.presence",
      printerId: "test-bridge",
      online: false,
    });
  } finally {
    bridge?.terminate();
    admin.terminate();
    await server.close();
  }
});

test("invoice outbox reaches a restarted-safe file bridge as Persian ESC/POS and receives authoritative ACK", async () => {
  const path = await mkdtemp(join(tmpdir(), "armani-print-integration-"));
  const actualJobs = new MongoPrintJobs(connection);
  const renderer = new ReceiptRenderer(process.platform === "win32" ? "chrome" : undefined);
  const issued = makeIssuedInvoice(
    {
      id: orderId.toString(),
      code: "AC-0008932",
      customer: {
        id: new mongoose.Types.ObjectId().toString(),
        displayName: "علی محمدی",
        phone: "+989123456789",
      },
      items: [
        {
          productName: "لاته ویژه",
          categoryName: "قهوه",
          additions: [{ name: "شیر بادام", priceToman: 10000 }],
          quantity: 1,
          unitPriceToman: 120000,
          lineTotalToman: 120000,
        },
      ],
      pricing: { subtotalToman: 120000, discountToman: 0, deliveryToman: 0, totalToman: 120000 },
      transaction: { provider: "fake", reference: "REF-123" },
      notes: "داغ باشد",
      placedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      identity: {
        title: "کافه آرمانی",
        legalName: "",
        address: "تهران",
        phone: "",
        email: "",
        footer: "سپاس",
      },
      paperWidthMm: 58,
      printing: { automatic: true, printerId: "test-bridge" },
    },
  );
  const server = await startPrintRealtime({
    port: 0,
    path: "/ws",
    heartbeatMs: 1000,
    origins: [],
    authorizeBridge: async (printerId, token) =>
      printerId === "test-bridge" && token === "test_printer_bridge_token_32_characters",
    schedule,
    jobs: actualJobs,
    authenticateAdmin: async () => false,
    payload: async (job) => ({
      jobId: job.id,
      invoiceId: job.invoiceId,
      printerId: job.printerId,
      attempt: job.attempts,
      deliveryId: job.deliveryId,
      paperWidthMm: job.paperWidthMm,
      html: renderInvoiceHtml(
        { ...issued, id: job.invoiceId },
        job.paperWidthMm,
        await receiptFontDataUrl(),
      ),
    }),
  });
  const controller = new AbortController();
  const bridge = new PrintBridge(
    {
      url: `ws://127.0.0.1:${server.port}/ws?role=bridge`,
      printerId: "test-bridge",
      token: "test_printer_bridge_token_32_characters",
      journalDirectory: join(path, "journal"),
    },
    new FilePrinter(join(path, "receipts")),
    (job) => renderer.render(job),
    () => undefined,
  );
  const running = bridge.run(controller.signal);
  try {
    await printOutboxHandlers(connection, schedule, "fallback")["invoice.issued"](
      event("invoice.issued"),
    );
    for (let i = 0; i < 100 && !server.available("test-bridge"); i++) await delay(100);
    expect(server.available("test-bridge")).toBe(true);
    const dispatcher = new PrintDispatcher(actualJobs, schedule, server.deliver, server.available);
    await dispatcher.runOnce();
    const [job] = await actualJobs.byOrder(orderId.toString());
    for (let i = 0; i < 300 && (await actualJobs.get(job.id))?.status !== "printed"; i++)
      await delay(100);
    expect((await actualJobs.get(job.id))?.status).toBe("printed");
    const bytes = await readFile(join(path, "receipts", `${job.id}.escpos`));
    expect([...bytes.subarray(0, 8)]).toEqual([27, 64, 29, 118, 48, 0, 48, 0]);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect((await bridge.journal.read(job.id))?.state).toMatch(/printed|acknowledged/u);
    await bridge.handle({
      v: 1,
      type: "print.job",
      jobId: job.id,
      invoiceId: job.invoiceId,
      printerId: job.printerId,
      attempt: 2,
      deliveryId: "12345678-1234-1234-1234-123456789012",
      paperWidthMm: 58,
      html: renderInvoiceHtml({ ...issued, id: job.invoiceId }, 58, await receiptFontDataUrl()),
    });
    expect(await readFile(join(path, "receipts", `${job.id}.escpos`))).toEqual(bytes);
  } finally {
    controller.abort();
    await running;
    await renderer.close();
    await server.close();
    await rm(path, { recursive: true, force: true });
  }
});
