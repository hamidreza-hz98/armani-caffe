import "server-only";

import { createHash } from "node:crypto";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import type { AdminAuthorizer } from "../../../shared/security-ports.ts";
import type { InventoryOperations } from "../application/service.ts";
import {
  parseItem,
  parseStockRequest,
  stockId,
  stockInteger,
  stockObject,
  stockText,
} from "../contracts/stock.ts";
import { baseQuantity, type BaseUnit, stockStatus } from "../domain/quantity.ts";

type Stamp = { _id: Types.ObjectId; createdAt: Date; updatedAt: Date; __v: number };
type Item = Stamp & {
  name: string;
  unit: BaseUnit;
  onHand: number;
  reorderLevel: number;
  status: "active" | "archived";
};
type Movement = Stamp & {
  inventoryItemId: Types.ObjectId;
  delta: number;
  reason: string;
  before: number;
  after: number;
  unit: BaseUnit;
  orderId: Types.ObjectId | null;
  actorKind: "admin" | "system";
  actorId: Types.ObjectId | null;
  idempotencyKey: string;
  reversalOf: Types.ObjectId | null;
  requestId: Types.ObjectId | null;
  fingerprint: string;
};
type Approval = Stamp & {
  inventoryItemId: Types.ObjectId;
  kind: string;
  requestedDelta: number;
  unit: BaseUnit;
  reason: string;
  requestedBy: Types.ObjectId;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  status: "pending" | "approved" | "rejected";
  idempotencyKey: string;
  fingerprint: string;
  reversalOf: Types.ObjectId | null;
  movementId: Types.ObjectId | null;
};
type Event = { type: string; payload: Record<string, string | number | boolean | null> };
export type InventoryRecord = (
  session: ClientSession,
  actor: { kind: "admin" | "system"; id: string | null },
  action: string,
  id: string,
  requestId: string,
  events?: Event[],
) => Promise<void>;
const oid = (id: unknown) => new Types.ObjectId(stockId(id));
const dto = (row: Stamp) => ({
  ...Object.fromEntries(
    Object.entries(row)
      .filter(
        ([key]) =>
          !["_id", "__v", "createdAt", "updatedAt", "fingerprint", "idempotencyKey"].includes(key),
      )
      .map(([key, value]) => [
        key,
        value instanceof Types.ObjectId
          ? value.toString()
          : value instanceof Date
            ? value.toISOString()
            : value,
      ]),
  ),
  id: row._id.toString(),
  revision: row.__v,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
const fingerprint = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
export class MongoInventoryRepository implements InventoryOperations {
  private readonly connection: Connection;
  private readonly authorize: AdminAuthorizer;
  private readonly record: InventoryRecord;
  private readonly now: () => Date;
  constructor(
    connection: Connection,
    authorize: AdminAuthorizer,
    record: InventoryRecord,
    now: () => Date = () => new Date(),
  ) {
    this.connection = connection;
    this.authorize = authorize;
    this.record = record;
    this.now = now;
  }
  private items() {
    return this.connection.db!.collection<Item>("inventory_items");
  }
  private ledger() {
    return this.connection.db!.collection<Movement>("inventory_movements");
  }
  private approvals() {
    return this.connection.db!.collection<Approval>("stock_approval_requests");
  }
  private stamp(id = new Types.ObjectId()): Stamp {
    return { _id: id, createdAt: this.now(), updatedAt: this.now(), __v: 0 };
  }
  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    try {
      return await this.connection.transaction(
        async (session) => {
          await this.ready(session);
          return work(session);
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        throw new ApplicationError("CONFLICT", "Inventory uniqueness conflict; reload and retry");
      throw new ApplicationError("UNAVAILABLE", "Inventory transaction failed");
    }
  }
  private async ready(session: ClientSession) {
    if (
      !(await this.connection
        .db!.collection<{ _id: number }>("_schema_migrations")
        .findOne({ _id: 7 }, { session }))
    )
      throw new ApplicationError("UNAVAILABLE", "Apply inventory ledger migration 7 before use");
  }
  async list(token: string | null) {
    await this.authorize(token, "inventory.read");
    return (await this.items().find({}).sort({ name: 1, _id: 1 }).limit(200).toArray()).map(
      (row) => ({ ...dto(row), stockStatus: stockStatus(row.onHand, row.reorderLevel) }),
    );
  }
  async requests(token: string | null) {
    await this.authorize(token, "inventory.read");
    return (
      await this.approvals().find({}).sort({ createdAt: -1, _id: -1 }).limit(200).toArray()
    ).map(dto);
  }
  async movements(token: string | null, id: unknown) {
    await this.authorize(token, "inventory.read");
    return (
      await this.ledger()
        .find({ inventoryItemId: oid(id) })
        .sort({ createdAt: -1, _id: -1 })
        .limit(200)
        .toArray()
    ).map(dto);
  }
  async create(token: string | null, raw: unknown, requestId: string) {
    const input = parseItem(raw);
    return this.transaction(async (session) => {
      const actor = await this.authorize(token, "inventory.approve", session);
      const row: Item = { ...this.stamp(), ...input, onHand: 0, status: "active" };
      await this.items().insertOne(row, { session });
      await this.record(
        session,
        { kind: "admin", id: actor.id },
        "inventory.created",
        row._id.toString(),
        requestId,
      );
      return dto(row);
    });
  }
  async update(token: string | null, id: unknown, raw: unknown, requestId: string) {
    const input = stockObject(raw, ["revision", "name", "reorderLevel", "status"]);
    const revision = stockInteger(input.revision);
    const fields: Partial<Item> = { updatedAt: this.now() };
    if (input.name !== undefined) fields.name = stockText(input.name);
    if (input.reorderLevel !== undefined) fields.reorderLevel = stockInteger(input.reorderLevel);
    if (input.status !== undefined) {
      if (input.status !== "active" && input.status !== "archived")
        throw new ApplicationError("VALIDATION", "Invalid stock status");
      fields.status = input.status;
    }
    if (Object.keys(fields).length === 1)
      throw new ApplicationError("VALIDATION", "Empty inventory update");
    return this.transaction(async (session) => {
      const actor = await this.authorize(token, "inventory.approve", session);
      const prior = await this.items().findOne({ _id: oid(id), __v: revision }, { session });
      if (!prior) throw new ApplicationError("CONFLICT", "Inventory revision conflict");
      if (prior.status === "archived" && fields.status === "active")
        throw new ApplicationError("CONFLICT", "Archived stock cannot be reactivated implicitly");
      if (
        fields.status === "archived" &&
        (prior.onHand !== 0 ||
          (await this.approvals().countDocuments(
            { inventoryItemId: prior._id, status: "pending" },
            { session },
          )) ||
          (await this.connection
            .db!.collection("product_consumption_rules")
            .countDocuments({ inventoryItemId: prior._id, active: true }, { session })))
      )
        throw new ApplicationError("CONFLICT", "Stock or dependencies prevent archive");
      const row = await this.items().findOneAndUpdate(
        { _id: prior._id, __v: revision },
        { $set: fields, $inc: { __v: 1 } },
        { session, returnDocument: "after" },
      );
      if (!row) throw new ApplicationError("CONFLICT", "Inventory revision conflict");
      const events = this.threshold(prior, row);
      await this.record(
        session,
        { kind: "admin", id: actor.id },
        "inventory.updated",
        prior._id.toString(),
        requestId,
        events,
      );
      return { ...dto(row), stockStatus: stockStatus(row.onHand, row.reorderLevel) };
    });
  }
  private threshold(before: Item, after: Item): Event[] {
    const previous = stockStatus(before.onHand, before.reorderLevel),
      current = stockStatus(after.onHand, after.reorderLevel);
    return previous === current
      ? []
      : [
          {
            type: "inventory.threshold_changed",
            payload: {
              inventoryItemId: after._id.toString(),
              previous,
              current,
              onHand: after.onHand,
              reorderLevel: after.reorderLevel,
            },
          },
        ];
  }
  async request(token: string | null, raw: unknown, requestId: string) {
    const input = parseStockRequest(raw);
    return this.transaction(async (session) => {
      const actor = await this.authorize(
        token,
        input.kind === "initial" || input.kind === "reversal"
          ? "inventory.approve"
          : "inventory.request",
        session,
      );
      const digest = fingerprint({ ...input, actorId: actor.id });
      const existing = await this.approvals().findOne(
        { idempotencyKey: input.idempotencyKey },
        { session },
      );
      if (existing) {
        if (existing.fingerprint !== digest)
          throw new ApplicationError("CONFLICT", "Idempotency key reused with different request");
        return dto(existing);
      }
      // Touch item to serialize new requests with archive, approvals, and stock changes.
      const item = await this.items().findOneAndUpdate(
        { _id: oid(input.inventoryItemId), status: "active" },
        { $inc: { __v: 1 } },
        { session, returnDocument: "after" },
      );
      if (!item) throw new ApplicationError("NOT_FOUND", "Active inventory item required");
      let delta: number;
      if (input.reversalOf) {
        const original = await this.ledger().findOne(
          { _id: oid(input.reversalOf), inventoryItemId: item._id },
          { session },
        );
        if (!original || original.reversalOf || original.reason === "initial")
          throw new ApplicationError("CONFLICT", "Movement cannot be reversed");
        if (await this.ledger().findOne({ reversalOf: original._id }, { session }))
          throw new ApplicationError("CONFLICT", "Movement already reversed");
        delta = -original.delta;
      } else delta = baseQuantity(input.quantity, input.unit, item.unit);
      if (
        !delta ||
        ((input.kind === "initial" || input.kind === "purchase") && delta < 0) ||
        (input.kind === "waste" && delta > 0)
      )
        throw new ApplicationError("VALIDATION", "Invalid quantity direction");
      if (
        input.kind === "initial" &&
        (item.onHand !== 0 ||
          (await this.ledger().countDocuments({ inventoryItemId: item._id }, { session })))
      )
        throw new ApplicationError(
          "CONFLICT",
          "Initial balance requires an untouched zero-balance item",
        );
      const row: Approval = {
        ...this.stamp(),
        inventoryItemId: item._id,
        kind: input.kind,
        requestedDelta: delta,
        unit: item.unit,
        reason: input.reason,
        requestedBy: oid(actor.id),
        decidedBy: null,
        decidedAt: null,
        status: "pending",
        idempotencyKey: input.idempotencyKey,
        fingerprint: digest,
        reversalOf: input.reversalOf ? oid(input.reversalOf) : null,
        movementId: null,
      };
      await this.approvals().insertOne(row, { session });
      await this.record(
        session,
        { kind: "admin", id: actor.id },
        "inventory.requested",
        row._id.toString(),
        requestId,
      );
      return dto(row);
    });
  }
  private async move(
    session: ClientSession,
    item: Item,
    values: Omit<Movement, keyof Stamp | "before" | "after" | "unit">,
  ) {
    const after = item.onHand + values.delta;
    if (!Number.isSafeInteger(after) || after < 0)
      throw new ApplicationError("CONFLICT", "Insufficient stock or quantity overflow");
    if (
      values.reversalOf &&
      (await this.ledger().findOne({ reversalOf: values.reversalOf }, { session }))
    )
      throw new ApplicationError("CONFLICT", "Movement already reversed");
    const result = await this.items().updateOne(
      { _id: item._id, status: "active", __v: item.__v },
      { $set: { onHand: after, updatedAt: this.now() }, $inc: { __v: 1 } },
      { session },
    );
    if (result.matchedCount !== 1)
      throw new ApplicationError("CONFLICT", "Concurrent stock change");
    const row: Movement = {
      ...this.stamp(),
      ...values,
      before: item.onHand,
      after,
      unit: item.unit,
    };
    await this.ledger().insertOne(row, { session });
    return { row, events: this.threshold(item, { ...item, onHand: after }) };
  }
  async decide(token: string | null, id: unknown, raw: unknown, requestId: string) {
    const input = stockObject(raw, ["decision"]);
    if (input.decision !== "approved" && input.decision !== "rejected")
      throw new ApplicationError("VALIDATION", "Invalid approval decision");
    const decision = input.decision;
    return this.transaction(async (session) => {
      const actor = await this.authorize(token, "inventory.approve", session);
      const prior = await this.approvals().findOne({ _id: oid(id) }, { session });
      if (!prior) throw new ApplicationError("NOT_FOUND", "Stock request not found");
      if (prior.status !== "pending") {
        if (prior.status !== input.decision)
          throw new ApplicationError("CONFLICT", "Stock request already decided");
        return dto(prior);
      }
      let movement: Movement | null = null;
      let events: Event[] = [];
      if (input.decision === "approved") {
        const item = await this.items().findOne(
          { _id: prior.inventoryItemId, status: "active" },
          { session },
        );
        if (!item || item.unit !== prior.unit)
          throw new ApplicationError("CONFLICT", "Request item is unavailable or changed units");
        if (
          prior.kind === "initial" &&
          (item.onHand !== 0 ||
            (await this.ledger().countDocuments({ inventoryItemId: item._id }, { session })))
        )
          throw new ApplicationError("CONFLICT", "Initial balance no longer permitted");
        if (prior.reversalOf) {
          const original = await this.ledger().findOne(
            { _id: prior.reversalOf, inventoryItemId: item._id },
            { session },
          );
          if (
            !original ||
            original.reversalOf ||
            original.reason === "initial" ||
            prior.requestedDelta !== -original.delta
          )
            throw new ApplicationError("CONFLICT", "Inconsistent reversal");
        }
        const moved = await this.move(session, item, {
          inventoryItemId: item._id,
          delta: prior.requestedDelta,
          reason: prior.kind === "adjustment" ? "adjustment" : prior.kind,
          orderId: null,
          actorKind: "admin",
          actorId: oid(actor.id),
          idempotencyKey: `approval:${prior._id}`,
          reversalOf: prior.reversalOf,
          requestId: prior._id,
          fingerprint: prior.fingerprint,
        });
        movement = moved.row;
        events = moved.events;
      }
      const row = await this.approvals().findOneAndUpdate(
        { _id: prior._id, status: "pending" },
        {
          $set: {
            status: decision,
            decidedBy: oid(actor.id),
            decidedAt: this.now(),
            movementId: movement?._id ?? null,
            updatedAt: this.now(),
          },
          $inc: { __v: 1 },
        },
        { session, returnDocument: "after" },
      );
      if (!row) throw new ApplicationError("CONFLICT", "Concurrent stock decision");
      await this.record(
        session,
        { kind: "admin", id: actor.id },
        `inventory.${input.decision}`,
        row._id.toString(),
        requestId,
        events,
      );
      return dto(row);
    });
  }
  /** Trusted server port: caller's order transaction is mandatory; never exposed via HTTP. */
  async consumeOrder(
    session: ClientSession,
    orderId: string,
    quantities: readonly { inventoryItemId: string; quantity: number; unit: BaseUnit }[],
    requestId: string,
  ) {
    if (!session.inTransaction())
      throw new ApplicationError("VALIDATION", "Order stock requires an active transaction");
    await this.ready(session);
    oid(orderId);
    if (
      !quantities.length ||
      quantities.length > 200 ||
      new Set(quantities.map((q) => q.inventoryItemId)).size !== quantities.length
    )
      throw new ApplicationError("VALIDATION", "Invalid aggregated order stock");
    const receipts = this.connection.db!.collection<{ _id: string; fingerprint: string }>(
      "inventory_order_receipts",
    );
    const manifest = fingerprint(
      [...quantities].sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId)),
    );
    const receipt = await receipts.findOne({ _id: orderId }, { session });
    if (receipt) {
      if (receipt.fingerprint !== manifest)
        throw new ApplicationError("CONFLICT", "Order stock manifest differs");
      return;
    }
    await receipts.insertOne({ _id: orderId, fingerprint: manifest }, { session });
    for (const quantity of [...quantities].sort((a, b) =>
      a.inventoryItemId.localeCompare(b.inventoryItemId),
    )) {
      const amount = stockInteger(quantity.quantity);
      if (!amount) throw new ApplicationError("VALIDATION", "Positive order stock required");
      const key = `order:${orderId}:${stockId(quantity.inventoryItemId)}`,
        digest = fingerprint(quantity);
      const existing = await this.ledger().findOne({ idempotencyKey: key }, { session });
      if (existing) {
        if (existing.fingerprint !== digest)
          throw new ApplicationError("CONFLICT", "Order stock retry differs");
        continue;
      }
      const item = await this.items().findOne(
        { _id: oid(quantity.inventoryItemId), status: "active" },
        { session },
      );
      if (!item || quantity.unit !== item.unit)
        throw new ApplicationError("CONFLICT", "Order inventory unavailable or incompatible");
      const { row, events } = await this.move(session, item, {
        inventoryItemId: item._id,
        delta: -amount,
        reason: "sale",
        orderId: oid(orderId),
        actorKind: "system",
        actorId: null,
        idempotencyKey: key,
        reversalOf: null,
        requestId: null,
        fingerprint: digest,
      });
      await this.record(
        session,
        { kind: "system", id: null },
        "inventory.consumed",
        row._id.toString(),
        requestId,
        events,
      );
    }
  }
  /** Product module supplies its own transaction and validated product identity. */
  async replaceConsumptionRules(
    session: ClientSession,
    productId: string,
    rules: readonly { inventoryItemId: string; quantity: string | number; unit: string }[],
  ) {
    if (!session.inTransaction())
      throw new ApplicationError("VALIDATION", "Stock rules require an active transaction");
    await this.ready(session);
    const product = oid(productId);
    if (rules.length > 100 || new Set(rules.map((r) => r.inventoryItemId)).size !== rules.length)
      throw new ApplicationError("VALIDATION", "Duplicate or excessive stock rules");
    const normalized = [];
    const collection = this.connection.db!.collection("product_consumption_rules");
    const oldRules = await collection.find({ productId: product }, { session }).toArray();
    for (const old of oldRules.sort((a, b) =>
      String(a.inventoryItemId).localeCompare(String(b.inventoryItemId)),
    ))
      await this.items().updateOne({ _id: old.inventoryItemId }, { $inc: { __v: 1 } }, { session });
    for (const rule of [...rules].sort((a, b) =>
      a.inventoryItemId.localeCompare(b.inventoryItemId),
    )) {
      const item = await this.items().findOneAndUpdate(
        { _id: oid(rule.inventoryItemId), status: "active" },
        { $inc: { __v: 1 } },
        { session, returnDocument: "after" },
      );
      if (!item) throw new ApplicationError("CONFLICT", "Active rule inventory required");
      const quantityPerUnit = baseQuantity(rule.quantity, rule.unit, item.unit);
      if (quantityPerUnit <= 0)
        throw new ApplicationError("VALIDATION", "Positive consumption required");
      normalized.push({
        ...this.stamp(),
        productId: product,
        inventoryItemId: item._id,
        quantityPerUnit,
        active: true,
      });
    }
    await collection.deleteMany({ productId: product }, { session });
    if (normalized.length) await collection.insertMany(normalized, { session, ordered: true });
    return normalized.map(dto);
  }
}
