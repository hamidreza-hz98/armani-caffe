import "server-only";

import type { Connection } from "mongoose";

import { businessIndexes } from "./business-indexes.ts";
import * as baseline from "./migrations/0001-baseline.ts";
import * as mediaWorkflows from "./migrations/0002-media-workflows.ts";
import * as typedSettings from "./migrations/0003-typed-settings.ts";
import * as adminSecurity from "./migrations/0004-admin-security.ts";
import * as customerSecurity from "./migrations/0005-customer-security.ts";
import * as categoryOrder from "./migrations/0006-category-order.ts";
import * as inventoryLedger from "./migrations/0007-inventory-ledger.ts";
import * as productWorkflows from "./migrations/0008-product-workflows.ts";
import * as cartWorkflows from "./migrations/0009-cart-workflows.ts";
import * as paymentFramework from "./migrations/0010-payment-framework.ts";
import * as orderConfirmation from "./migrations/0011-order-confirmation.ts";

export const migrations = [
  baseline,
  mediaWorkflows,
  typedSettings,
  adminSecurity,
  customerSecurity,
  categoryOrder,
  inventoryLedger,
  productWorkflows,
  cartWorkflows,
  paymentFramework,
  orderConfirmation,
] as const;

export const databaseIndexes = [
  {
    collection: "_schema_migrations",
    keys: { appliedAt: 1 },
    name: "migration_applied_at",
  },
  { collection: "_seed_runs", keys: { createdAt: 1 }, name: "seed_created_at" },
  ...businessIndexes,
] as const;

function database(connection: Connection): NonNullable<Connection["db"]> {
  if (!connection.db) throw new Error("MongoDB connection has no selected database");
  return connection.db;
}

export async function migrationStatus(connection: Connection) {
  const collection = database(connection).collection<{ _id: number; appliedAt: Date }>(
    "_schema_migrations",
  );
  const applied = await Promise.all(
    migrations.map((migration) => collection.findOne({ _id: migration.version })),
  );
  return migrations.map((migration, index) => ({
    version: migration.version,
    description: migration.description,
    appliedAt: applied[index]?.appliedAt ?? null,
  }));
}

export async function applyMigrations(connection: Connection, now: () => Date = () => new Date()) {
  const db = database(connection);
  const applied = [];
  for (const migration of migrations) {
    let didApply = false;
    await connection.transaction(async (session) => {
      const ledger = db.collection<{ _id: number; appliedAt: Date }>("_schema_migrations");
      if (await ledger.findOne({ _id: migration.version }, { session })) return;
      const timestamp = now();
      await migration.up(db, session, timestamp);
      await ledger.insertOne({ _id: migration.version, appliedAt: timestamp }, { session });
      didApply = true;
    });
    if (didApply) applied.push(migration.version);
  }
  return applied;
}

export async function seedBaseline(connection: Connection, now: () => Date = () => new Date()) {
  const db = database(connection);
  await connection.transaction(async (session) => {
    await db
      .collection<{ _id: string; createdAt: Date }>("_seed_runs")
      .updateOne(
        { _id: "baseline-v1" },
        { $setOnInsert: { createdAt: now() } },
        { upsert: true, session },
      );
  });
}

export async function applyDatabaseIndexes(connection: Connection) {
  const db = database(connection);
  for (const index of databaseIndexes) {
    const collection = db.collection(index.collection);
    const options = "options" in index ? index.options : {};
    await collection.createIndex(index.keys as Parameters<typeof collection.createIndex>[0], {
      name: index.name,
      ...("unique" in options && options.unique === true ? { unique: true } : {}),
      ...("partialFilterExpression" in options
        ? { partialFilterExpression: options.partialFilterExpression }
        : {}),
      ...("expireAfterSeconds" in options
        ? { expireAfterSeconds: options.expireAfterSeconds }
        : {}),
      ...("default_language" in options ? { default_language: options.default_language } : {}),
    });
  }
}
