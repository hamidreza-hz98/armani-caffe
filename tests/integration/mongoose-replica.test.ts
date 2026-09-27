import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Schema } from "mongoose";
import { afterAll, beforeAll, expect, test } from "vitest";

import {
  documentSchemaOptions,
  iranianMobileField,
  tomanAmountField,
} from "../../src/server/database/conventions.ts";
import { mapDuplicateKey } from "../../src/server/database/errors.ts";
import { applyDatabaseIndexes, databaseIndexes } from "../../src/server/database/operations.ts";
import { applyPagination } from "../../src/server/database/pagination.ts";
import { customerFactory, isolatedResources, sequentialObjectIds } from "../fixtures/isolation.ts";

const resources = isolatedResources("mongoose");
let replica: MongoMemoryReplSet | undefined;
let connection: mongoose.Connection | undefined;

beforeAll(async () => {
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
