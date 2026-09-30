import assert from "node:assert/strict";

import { test } from "vitest";

import {
  applyDatabaseIndexes,
  applyMigrations,
  databaseIndexes,
  migrationStatus,
  seedBaseline,
} from "../../src/server/database/operations.ts";

function fakeConnection() {
  const collections = new Map();
  const indexes = [];
  let transactions = 0;
  const db = {
    collection(name) {
      if (!collections.has(name)) collections.set(name, new Map());
      const records = collections.get(name);
      return {
        aggregate() {
          return {
            async toArray() {
              return [];
            },
          };
        },
        find() {
          return {
            sort() {
              return this;
            },
            async toArray() {
              return [];
            },
          };
        },
        async findOne(filter) {
          return records.get(filter._id) ?? null;
        },
        async countDocuments() {
          return records.size;
        },
        async insertOne(document) {
          if (records.has(document._id)) throw { code: 11000 };
          records.set(document._id, document);
        },
        async updateOne(filter, update) {
          if (!records.has(filter._id))
            records.set(filter._id, { _id: filter._id, ...update.$setOnInsert });
        },
        async updateMany() {
          return { matchedCount: 0 };
        },
        async deleteMany() {
          return { deletedCount: 0 };
        },
        async createIndex(keys, options) {
          indexes.push({ collection: name, keys, name: options.name });
        },
      };
    },
  };
  return {
    db,
    collections,
    indexes,
    get transactions() {
      return transactions;
    },
    async transaction(work) {
      transactions += 1;
      return work({ id: "fake-session" });
    },
  };
}

test("migration status is read-only and migrations apply once in transactions", async () => {
  const connection = fakeConnection();
  assert.equal((await migrationStatus(connection))[0].appliedAt, null);
  assert.equal(connection.transactions, 0);
  const fixed = new Date("2025-01-01T00:00:00.000Z");
  assert.deepEqual(
    await applyMigrations(connection, () => fixed),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.deepEqual(await applyMigrations(connection, () => fixed), []);
  assert.equal((await migrationStatus(connection))[0].appliedAt, fixed);
  assert.equal(
    connection.collections.get("_app_metadata").get("schema-baseline").initializedAt,
    fixed,
  );
  assert.equal(connection.transactions, 24);
});

test("baseline seed is idempotent and indexes apply only when requested", async () => {
  const connection = fakeConnection();
  const first = new Date("2025-01-01T00:00:00.000Z");
  await seedBaseline(connection, () => first);
  await seedBaseline(connection, () => new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(connection.collections.get("_seed_runs").size, 1);
  assert.equal(connection.collections.get("_seed_runs").get("baseline-v1").createdAt, first);
  assert.equal(connection.indexes.length, 0);
  await applyDatabaseIndexes(connection);
  assert.equal(connection.indexes.length, databaseIndexes.length);
});
