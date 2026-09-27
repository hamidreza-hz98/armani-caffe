import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import {
  nonNegativeIntegerField,
  requiredText,
  utcDateField,
} from "../../../server/database/schema-fields.ts";
import { assertSafeRecord } from "../../../shared/safe-record.ts";

const actorSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ["admin", "customer", "system"] },
    id: { type: String, default: null },
  },
  { _id: false, strict: "throw" },
);

export const outboxEventSchema = new Schema(
  {
    aggregateKind: requiredText(80),
    aggregateId: requiredText(120),
    eventType: requiredText(120),
    payload: { type: Schema.Types.Mixed, required: true },
    requestId: requiredText(80),
    actor: { type: actorSchema, required: true },
    status: {
      type: String,
      required: true,
      enum: ["pending", "processing", "delivered", "dead"],
      default: "pending",
    },
    attempts: nonNegativeIntegerField(),
    availableAt: utcDateField(),
    lockedUntil: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    idempotencyKey: requiredText(128),
    maxAttempts: { type: Number, required: true, min: 1, max: 20, default: 8 },
    claimToken: { type: String, default: null },
    claimedBy: { type: String, default: null },
    lastFailureCode: { type: String, default: null },
    failedAt: { type: Date, default: null },
    replayCount: { ...nonNegativeIntegerField(), default: 0 },
  },
  { ...documentSchemaOptions(true), collection: "outbox_events" },
);
outboxEventSchema.index({ idempotencyKey: 1 }, { unique: true, name: "outbox_idempotency_unique" });
outboxEventSchema.index({ status: 1, availableAt: 1, lockedUntil: 1 }, { name: "outbox_claim" });
outboxEventSchema.index({ requestId: 1, createdAt: -1 }, { name: "outbox_request_time" });
outboxEventSchema.index(
  { aggregateKind: 1, aggregateId: 1, createdAt: -1 },
  { name: "outbox_aggregate" },
);
outboxEventSchema.index(
  { deliveredAt: 1 },
  {
    expireAfterSeconds: 90 * 24 * 60 * 60,
    partialFilterExpression: { status: "delivered" },
    name: "outbox_delivered_ttl",
  },
);
outboxEventSchema.pre("validate", function () {
  const payload = this.get("payload") as Record<string, unknown>;
  try {
    assertSafeRecord(payload);
  } catch (error) {
    this.invalidate("payload", (error as Error).message);
  }
  if (this.get("status") === "processing" && !this.get("lockedUntil")) {
    this.invalidate("lockedUntil", "Processing event needs a lease");
  }
  if (this.get("status") === "delivered" && !this.get("deliveredAt")) {
    this.invalidate("deliveredAt", "Delivered event needs a timestamp");
  }
});
