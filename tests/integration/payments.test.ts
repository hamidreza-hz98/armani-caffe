import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import type { PaymentView } from "@/modules/payments";
import {
  createPaymentCallbackHandler,
  MongoFakeLedger,
  type ProviderFactory,
  type VerificationResult,
} from "@/modules/payments/server";
import { settingsDefaults } from "@/modules/settings";
import {
  createSettingsRepository,
  SettingsService,
  SettingsVault,
} from "@/modules/settings/server";
import { composePaymentFramework } from "@/server/commerce/payments";
import { applyDatabaseIndexes, applyMigrations } from "@/server/database/operations";

import { testEnv } from "../fixtures/config.mjs";
import { isolatedResources } from "../fixtures/isolation";
let replica: MongoMemoryReplSet, connection: mongoose.Connection;
const time = new Date("2026-01-01T00:00:00Z"),
  clock = () => new Date(time),
  key = "1".repeat(64),
  origin = "https://caffe.example";
const owner = { id: "000000000000000000000001", role: "OWNER" as const };
let orderSequence = 1;
let settings: SettingsService,
  ledger: MongoFakeLedger,
  payments: ReturnType<typeof composePaymentFramework>;
const vault = new SettingsVault(key, undefined, clock);
const intent = async (id: string, session: mongoose.ClientSession) => {
  const row = await connection
    .db!.collection("orders")
    .findOne({ _id: new mongoose.Types.ObjectId(id), paymentStatus: "pending" }, { session });
  if (!row) throw new Error("Nonpayable order");
  return { amountToman: row.totalToman as number };
};
const make = (adapters?: Map<string, ProviderFactory>, timeoutMs?: number, v = vault) =>
  composePaymentFramework(connection, {
    vault: v,
    callbackBaseUrl: origin,
    intent,
    now: clock,
    adapters,
    timeoutMs,
  });
const createOrder = async (amountToman = 100000) => {
  const id = new mongoose.Types.ObjectId();
  await connection.db!.collection("orders").insertOne({
    _id: id,
    totalToman: amountToman,
    paymentStatus: "pending",
    idempotencyKey: "order-" + id,
    code: "AC-" + String(orderSequence++).padStart(7, "0"),
  });
  return String(id);
};
const create = async (id?: string) =>
  payments.create(
    id ?? (await createOrder()),
    "pay-" + new mongoose.Types.ObjectId(),
    "request-create-123",
  );
const callback = (view: PaymentView, extra?: Record<string, string>) => {
  const url = new URL(view.redirectUrl!);
  for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
  return payments.callback(
    view.id,
    view.provider,
    "GET",
    url,
    Object.fromEntries(url.searchParams),
    "request-callback-123",
  );
};
const paid = (
  view: PaymentView,
  extra?: Partial<Extract<VerificationResult, { kind: "succeeded" }>>,
): VerificationResult => ({
  kind: "succeeded",
  authority: view.authority!,
  reference: "ref-" + view.id,
  amountToman: view.amountToman,
  currency: "TOMAN",
  ...extra,
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
    .createConnection(replica.getUri(isolatedResources("payments").databaseName), {
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    })
    .asPromise();
  await applyDatabaseIndexes(connection);
  await applyMigrations(connection, clock);
});
beforeEach(async () => {
  for (const name of [
    "transactions",
    "orders",
    "fake_payment_ledger",
    "audit_events",
    "outbox_events",
    "settings",
    "settings_receipts",
  ])
    await connection.db!.collection(name).deleteMany({});
  settings = new SettingsService(createSettingsRepository(connection, vault, clock));
  await settings.update(
    owner,
    "payment",
    "enable-fake-payment",
    {
      revision: 0,
      values: { ...settingsDefaults("payment"), fakeEnabled: true, defaultProvider: "fake" },
    },
    "request-settings-123",
  );
  ledger = new MongoFakeLedger(connection);
  payments = make();
});
afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
  if (replica) await replica.stop();
});
test("browser success hints do not settle; authoritative evidence emits exactly one success event", async () => {
  const view = await create();
  expect(view.status).toBe("pending");
  expect((await callback(view, { result: "success" })).status).toBe("pending");
  await ledger.outcome(view.authority!, paid(view));
  const results = await Promise.all([callback(view), callback(view)]);
  expect(results.some((r) => r.status === "succeeded")).toBe(true);
  expect((await callback(view)).status).toBe("succeeded");
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "payment.succeeded" }),
  ).toBe(1);
  expect(
    await connection.db!.collection("audit_events").countDocuments({ action: "payment.succeeded" }),
  ).toBe(1);
});
test("creation idempotency binds the order, and separate keys cannot start duplicate payable attempts", async () => {
  const orderId = await createOrder(),
    requestKey = "payment-key-same";
  const [a, b] = await Promise.all([
    payments.create(orderId, requestKey, "request-create-a"),
    payments.create(orderId, requestKey, "request-create-b"),
  ]);
  expect(a.id).toBe(b.id);
  expect(await connection.db!.collection("transactions").countDocuments({})).toBe(1);
  await expect(
    payments.create(await createOrder(), requestKey, "request-create-c"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    payments.create(orderId, "different-payment-key", "request-create-d"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
test.each(["amount", "authority", "unknown"])(
  "%s verification remains unresolved until corrected evidence arrives",
  async (scenario) => {
    const view = await create();
    await ledger.outcome(
      view.authority!,
      scenario === "unknown"
        ? { kind: "unknown" }
        : paid(
            view,
            scenario === "amount" ? { amountToman: 1 } : { authority: "foreign-authority" },
          ),
    );
    const result = await callback(view);
    expect(result.status).toBe("pending");
    expect(result.issue).toBe(
      scenario === "amount"
        ? "AMOUNT_MISMATCH"
        : scenario === "authority"
          ? "AUTHORITY_MISMATCH"
          : "AMBIGUOUS_VERIFICATION",
    );
    expect(
      await connection
        .db!.collection("outbox_events")
        .countDocuments({ eventType: "payment.succeeded" }),
    ).toBe(0);
    await ledger.outcome(view.authority!, paid(view));
    expect((await payments.inquire(view.id, "request-inquiry-123")).status).toBe("succeeded");
  },
);
test("authoritative failed payments are terminal even after delayed forged or contradictory callbacks", async () => {
  const view = await create();
  await ledger.outcome(view.authority!, { kind: "failed", authority: view.authority! });
  expect((await callback(view)).status).toBe("failed");
  await ledger.outcome(view.authority!, paid(view));
  expect((await callback(view, { result: "success" })).status).toBe("failed");
  expect((await create(view.orderId)).status).toBe("pending");
});
test("callbacks reject foreign origins/providers, duplicate/unknown fields, state and authority forgery", async () => {
  const view = await create();
  await expect(callback(view, { state: "a".repeat(64) })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(callback(view, { amountToman: "1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(callback(view, { authority: "foreign" })).rejects.toMatchObject({
    code: "VALIDATION",
  });
  const wrong = new URL(view.redirectUrl!);
  wrong.hostname = "evil.example";
  await expect(
    payments.callback(
      view.id,
      "fake",
      "GET",
      wrong,
      Object.fromEntries(wrong.searchParams),
      "request-callback-123",
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const handler = createPaymentCallbackHandler({
    service: async () => payments,
    providerIds: () => ["fake"],
    callbackOrigin: () => origin,
  });
  expect(
    (await handler(new Request(view.redirectUrl! + "&authority=second"), "fake", view.id)).status,
  ).toBe(400);
});
test("reference reuse across orders is blocked and reconciliation preserves the pending attempt", async () => {
  const a = await create(),
    b = await create();
  await ledger.outcome(a.authority!, paid(a, { reference: "shared-reference" }));
  await ledger.outcome(b.authority!, paid(b, { reference: "shared-reference" }));
  expect((await callback(a)).status).toBe("succeeded");
  expect(await callback(b)).toMatchObject({
    status: "pending",
    issue: "REFERENCE_CONFLICT",
    reference: null,
  });
  expect(
    await connection
      .db!.collection("outbox_events")
      .countDocuments({ eventType: "payment.succeeded" }),
  ).toBe(1);
});
test("three registry adapters use priority/default settings and encrypted per-attempt credentials", async () => {
  const seen: string[] = [];
  const factories = new Map<string, ProviderFactory>(
    ["gateway-a", "gateway-b", "gateway-c"].map((id) => [
      id,
      (config) => {
        seen.push(config.credential!);
        return {
          id,
          idempotentCreate: true,
          callbackMethods: ["GET"],
          callbackFields: ["authority", "state"],
          redirectOrigins: [origin],
          create: async (r) => ({
            kind: "created",
            authority: id + "_" + r.paymentId,
            redirectUrl: r.callbackUrl + "&authority=" + id + "_" + r.paymentId,
          }),
          parseCallback: (fields) => ({ authority: fields.authority }),
          verify: async (r) => ({
            kind: "succeeded",
            authority: r.authority!,
            reference: "ref-" + r.paymentId,
            amountToman: r.amountToman,
            currency: "TOMAN",
          }),
          inquire: async () => ({ kind: "unknown" }),
        };
      },
    ]),
  );
  const credentials = {
    "gateway-a": "merchant-secret-a-long-enough",
    "gateway-b": "merchant-secret-b-long-enough",
    "gateway-c": "merchant-secret-c-long-enough",
  };
  const values = {
    ...settingsDefaults("payment"),
    defaultProvider: null,
    providers: [...factories.keys()].map((id, i) => ({
      id,
      enabled: true,
      priority: 3 - i,
      mode: "sandbox",
    })),
  };
  await settings.update(
    owner,
    "payment",
    "multi-gateway-config",
    { revision: 1, values, secrets: { providerCredentials: JSON.stringify(credentials) } },
    "request-settings-456",
  );
  payments = make(factories);
  const view = await create();
  expect(view.provider).toBe("gateway-c");
  const document = await connection
    .db!.collection("transactions")
    .findOne({ _id: new mongoose.Types.ObjectId(view.id) });
  expect(JSON.stringify(document)).not.toContain(credentials["gateway-c"]);
  await settings.update(
    owner,
    "payment",
    "rotate-gateway-creds",
    {
      revision: 2,
      values: { ...values, defaultProvider: "gateway-a" },
      secrets: {
        providerCredentials: JSON.stringify({
          ...credentials,
          "gateway-c": "rotated-merchant-secret-long-enough",
        }),
      },
    },
    "request-settings-789",
  );
  expect((await callback(view)).status).toBe("succeeded");
  expect(seen).toContain(credentials["gateway-c"]);
  expect(seen).not.toContain("rotated-merchant-secret-long-enough");
  expect((await create()).provider).toBe("gateway-a");
  const ownerSettings = await settings.read(owner, "payment");
  expect(JSON.stringify(ownerSettings)).not.toContain("merchant-secret");
});
test("network timeouts abort verification and do not report failure or success", async () => {
  const abort = vi.fn();
  const factory: ProviderFactory = () => ({
    id: "slow",
    idempotentCreate: true,
    callbackMethods: ["GET"],
    callbackFields: ["state", "authority"],
    redirectOrigins: [origin],
    create: async (r) => ({
      kind: "created",
      authority: "slow_" + r.paymentId,
      redirectUrl: r.callbackUrl + "&authority=slow_" + r.paymentId,
    }),
    parseCallback: (f) => ({ authority: f.authority }),
    verify: async (_, signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          abort();
          reject(new Error("merchant-secret-not-logged"));
        });
      }),
    inquire: async () => ({ kind: "unknown" }),
  });
  await settings.update(
    owner,
    "payment",
    "slow-provider-settings",
    {
      revision: 1,
      values: {
        ...settingsDefaults("payment"),
        defaultProvider: "slow",
        providers: [{ id: "slow", enabled: true, priority: 0, mode: "sandbox" }],
      },
      secrets: { providerCredentials: JSON.stringify({ slow: "merchant-secret-not-logged" }) },
    },
    "request-settings-456",
  );
  payments = make(new Map([["slow", factory]]), 10);
  const view = await create();
  expect(await callback(view)).toMatchObject({
    status: "pending",
    issue: "AMBIGUOUS_VERIFICATION",
  });
  expect(abort).toHaveBeenCalled();
});
test("ambiguous non-idempotent creation is never retried against the provider", async () => {
  const createRemote = vi.fn(async () => ({ kind: "unknown" as const }));
  const factory: ProviderFactory = () => ({
    id: "uncertain",
    idempotentCreate: false,
    callbackMethods: [],
    callbackFields: [],
    redirectOrigins: [origin],
    create: createRemote,
    parseCallback: () => {
      throw new Error();
    },
    verify: async () => ({ kind: "unknown" }),
    inquire: async () => ({ kind: "unknown" }),
  });
  await settings.update(
    owner,
    "payment",
    "uncertain-provider-settings",
    {
      revision: 1,
      values: {
        ...settingsDefaults("payment"),
        defaultProvider: "uncertain",
        providers: [{ id: "uncertain", enabled: true, priority: 0, mode: "sandbox" }],
      },
      secrets: {
        providerCredentials: JSON.stringify({ uncertain: "merchant-secret-uncertain-provider" }),
      },
    },
    "request-settings-456",
  );
  payments = make(new Map([["uncertain", factory]]));
  const order = await createOrder();
  expect(
    await payments.create(order, "uncertain-creation-key", "request-create-123"),
  ).toMatchObject({ status: "created", issue: "CREATION_AMBIGUOUS" });
  expect(
    await payments.create(order, "uncertain-creation-key", "request-create-456"),
  ).toMatchObject({ status: "created", issue: "CREATION_AMBIGUOUS" });
  expect(createRemote).toHaveBeenCalledTimes(1);
});
test("pending fake evidence survives framework restart and callback key rotation", async () => {
  const view = await create();
  await ledger.outcome(view.authority!, paid(view));
  payments = make(undefined, undefined, new SettingsVault("2".repeat(64), key, clock));
  expect((await callback(view)).status).toBe("succeeded");
});
test("failed audit/outbox writes roll back reservation without external provider calls", async () => {
  await connection
    .db!.collection("audit_events")
    .createIndex({ action: 1 }, { unique: true, name: "isolated-payment-audit-failure" });
  const first = await create();
  await expect(create()).rejects.toThrow();
  expect(await connection.db!.collection("transactions").countDocuments({})).toBe(1);
  expect(await connection.db!.collection("fake_payment_ledger").countDocuments({})).toBe(1);
  await connection.db!.collection("audit_events").dropIndex("isolated-payment-audit-failure");
  expect(first.status).toBe("pending");
});
test("fake provider is disabled in production and legacy transactions cannot be silently migrated", async () => {
  const production = composePaymentFramework(connection, {
    vault,
    callbackBaseUrl: origin,
    intent,
    production: true,
    now: clock,
  });
  await expect(
    production.create(await createOrder(), "production-attempt-123", "request-production-123"),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  const migration = await import("@/server/database/migrations/0010-payment-framework");
  await connection.db!.collection("transactions").insertOne({
    orderId: new mongoose.Types.ObjectId(),
    idempotencyKey: "legacy-pay-123",
    frameworkVersion: 0,
    status: "failed",
  });
  await expect(connection.transaction((tx) => migration.up(connection.db!, tx))).rejects.toThrow(
    "reconciliation",
  );
});
