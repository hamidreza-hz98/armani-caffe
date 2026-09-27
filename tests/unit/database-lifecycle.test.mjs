import assert from "node:assert/strict";
import test from "node:test";

import mongoose, { Schema } from "mongoose";

import { ConnectionCache } from "../../src/server/database/connection-cache.ts";
import {
  addSoftDelete,
  documentSchemaOptions,
  iranianMobileField,
  tomanAmountField,
} from "../../src/server/database/conventions.ts";
import { mapDuplicateKey } from "../../src/server/database/errors.ts";
import { applyPagination } from "../../src/server/database/pagination.ts";
import { inTransaction } from "../../src/server/database/transaction.ts";
import { normalizeIranianMobile } from "../../src/shared/phone.ts";

test("importing the database boundary does not connect", async () => {
  const before = mongoose.connections.length;
  await import("../../src/server/database/connection.ts");
  assert.equal(mongoose.connections.length, before);
});

test("connection cache coalesces opens, reuses healthy connections, and replaces stale ones", async () => {
  let opens = 0;
  let closes = 0;
  const cache = new ConnectionCache(async () => {
    opens += 1;
    return {
      readyState: 1,
      close: async () => {
        closes += 1;
      },
    };
  });
  const [first, concurrent] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(first, concurrent);
  assert.equal(opens, 1);
  assert.equal(await cache.get(), first);
  first.readyState = 0;
  const reopened = await cache.get();
  assert.notEqual(reopened, first);
  assert.equal(opens, 2);
  assert.equal(closes, 1);
});

test("failed initial connection is not cached", async () => {
  let attempts = 0;
  const cache = new ConnectionCache(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
    return { readyState: 1, close: async () => undefined };
  });
  await assert.rejects(cache.get(), /offline/);
  await cache.get();
  assert.equal(attempts, 2);
});

test("schema conventions opt in to optimistic concurrency and soft deletion", async () => {
  const schema = new Schema(
    { amountToman: tomanAmountField(), phone: iranianMobileField() },
    documentSchemaOptions(true),
  );
  assert.equal(schema.options.timestamps, true);
  assert.equal(schema.options.versionKey, "__v");
  assert.equal(schema.options.optimisticConcurrency, true);
  assert.equal(schema.options.autoIndex, false);
  assert.equal(schema.path("deletedAt"), undefined);
  addSoftDelete(schema);
  assert.ok(schema.path("deletedAt"));
  const Model = mongoose.model("DatabaseConventionUnit", schema);
  const document = new Model({ amountToman: 12500, phone: "۰۹۱۲ ۳۴۵ ۶۷۸۹" });
  assert.equal(document.phone, "+989123456789");
  await document.validate();
  document.amountToman = 1.5;
  await assert.rejects(document.validate());
});

test("phone, pagination, duplicate-key mapping, and transaction port behave safely", async () => {
  assert.equal(normalizeIranianMobile("0098-912-345-6789"), "+989123456789");
  assert.throws(() => normalizeIranianMobile("123"));
  const query = {
    skip(value) {
      this.offset = value;
      return this;
    },
    limit(value) {
      this.count = value;
      return this;
    },
  };
  const result = applyPagination(query, 2, 25);
  assert.equal(result.query.offset, 25);
  assert.equal(result.query.count, 25);
  assert.equal(result.pagination.page, 2);
  assert.equal(mapDuplicateKey({ code: 11000, keyPattern: { phone: 1 } })?.code, "CONFLICT");
  assert.equal(mapDuplicateKey({ code: 42 }), null);
  let transactions = 0;
  const value = await inTransaction(
    {
      run: async (work) => {
        transactions += 1;
        return work("session");
      },
    },
    async (session) => session,
  );
  assert.equal(value, "session");
  assert.equal(transactions, 1);
});
