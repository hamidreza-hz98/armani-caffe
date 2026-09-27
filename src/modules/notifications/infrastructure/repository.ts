import "server-only";

import { randomUUID } from "node:crypto";

import type { ClientSession, Connection } from "mongoose";

import type { OutboxDraft } from "../domain/model.ts";
import { outboxEventSchema } from "./schema.ts";

export function outboxModel(connection: Connection) {
  return connection.models.OutboxEvent ?? connection.model("OutboxEvent", outboxEventSchema);
}

export async function appendOutbox(
  connection: Connection,
  session: ClientSession,
  events: readonly OutboxDraft[],
  now: Date,
): Promise<void> {
  if (events.length === 0)
    throw new RangeError("A domain change requires at least one outbox event");
  await outboxModel(connection).create(
    events.map((event) => ({
      ...event,
      status: "pending",
      attempts: 0,
      maxAttempts: 8,
      availableAt: event.availableAt ? new Date(event.availableAt) : now,
      replayCount: 0,
    })),
    { session },
  );
}

export type ClaimedOutbox = Readonly<{
  id: string;
  claimToken: string;
  eventType: string;
  payload: Record<string, string | number | boolean | null>;
  aggregateKind: string;
  aggregateId: string;
  requestId: string;
  actor: { kind: "admin" | "customer" | "system"; id: string | null };
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
}>;

export async function claimOutbox(
  connection: Connection,
  workerId: string,
  now: Date,
  leaseMs: number,
  eventTypes: readonly string[],
): Promise<ClaimedOutbox | null> {
  if (eventTypes.length === 0) return null;
  const claimToken = randomUUID();
  const document = await outboxModel(connection)
    .findOneAndUpdate(
      {
        eventType: { $in: eventTypes },
        $or: [
          { status: "pending", availableAt: { $lte: now } },
          { status: "processing", lockedUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          status: "processing",
          claimToken,
          claimedBy: workerId,
          lockedUntil: new Date(now.getTime() + leaseMs),
        },
        $inc: { attempts: 1 },
      },
      { sort: { availableAt: 1, createdAt: 1, _id: 1 }, returnDocument: "after" },
    )
    .lean();
  if (!document) return null;
  return {
    id: String(document._id),
    claimToken,
    eventType: String(document.eventType),
    payload: document.payload as ClaimedOutbox["payload"],
    aggregateKind: String(document.aggregateKind),
    aggregateId: String(document.aggregateId),
    requestId: String(document.requestId),
    actor: document.actor as ClaimedOutbox["actor"],
    idempotencyKey: String(document.idempotencyKey),
    attempts: Number(document.attempts),
    maxAttempts: Number(document.maxAttempts),
  };
}

export async function finishOutbox(
  connection: Connection,
  claim: ClaimedOutbox,
  now: Date,
): Promise<boolean> {
  const result = await outboxModel(connection).updateOne(
    { _id: claim.id, status: "processing", claimToken: claim.claimToken },
    {
      $set: {
        status: "delivered",
        deliveredAt: now,
        lockedUntil: null,
        claimToken: null,
        claimedBy: null,
        lastFailureCode: null,
        failedAt: null,
      },
    },
  );
  return result.modifiedCount === 1;
}

export async function failOutbox(
  connection: Connection,
  claim: ClaimedOutbox,
  now: Date,
  failureCode: string,
  delayMs: number,
): Promise<boolean> {
  const dead = claim.attempts >= claim.maxAttempts;
  const result = await outboxModel(connection).updateOne(
    { _id: claim.id, status: "processing", claimToken: claim.claimToken },
    {
      $set: {
        status: dead ? "dead" : "pending",
        availableAt: new Date(now.getTime() + delayMs),
        lockedUntil: null,
        claimToken: null,
        claimedBy: null,
        lastFailureCode: failureCode,
        failedAt: now,
      },
    },
  );
  return result.modifiedCount === 1;
}

export async function replayOutbox(
  connection: Connection,
  id: string,
  now: Date,
): Promise<boolean> {
  const result = await outboxModel(connection).updateOne(
    { _id: id, status: { $in: ["dead", "delivered"] } },
    {
      $set: {
        status: "pending",
        attempts: 0,
        availableAt: now,
        lockedUntil: null,
        deliveredAt: null,
        claimToken: null,
        claimedBy: null,
        lastFailureCode: null,
        failedAt: null,
      },
      $inc: { replayCount: 1 },
    },
  );
  return result.modifiedCount === 1;
}
