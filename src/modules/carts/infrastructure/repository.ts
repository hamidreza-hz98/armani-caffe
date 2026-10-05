import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import type { CartPorts, CartRepository, CartView } from "../application/service.ts";
import {
  CART_MAX_LINES,
  CART_MAX_QUANTITY,
  CART_TTL_MS,
  type CartMutation,
} from "../contracts/cart.ts";
import { cartItemKey, type CartItemSnapshot, makeCartItemSnapshot } from "../domain/model.ts";
import { type CartIssue, priceCart } from "../domain/pricing.ts";

type StoredItem = Omit<CartItemSnapshot, "productId" | "additions"> & {
  productId: Types.ObjectId;
  additions: { additionId: Types.ObjectId; name: string; priceToman: number }[];
};
type Row = {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  sessionId: null;
  __v: number;
  items: StoredItem[];
  totalToman: number;
  notes: string;
  tableNumber?: number | null;
  status: "active" | "abandoned" | "checked_out";
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
const keyOf = (item: CartItemSnapshot) =>
  cartItemKey(
    item.productId,
    item.additions.map((a) => a.additionId),
  );
const storeItems = (items: readonly CartItemSnapshot[]): StoredItem[] =>
  items.map((i) => ({
    ...i,
    productId: new Types.ObjectId(i.productId),
    additions: i.additions.map((a) => ({ ...a, additionId: new Types.ObjectId(a.additionId) })),
  }));
const readItems = (row: Row): CartItemSnapshot[] =>
  row.items.map((i) => ({
    ...i,
    productId: String(i.productId),
    additions: i.additions.map((a) => ({
      ...a,
      additionId: String(a.additionId),
      priceToman: a.priceToman as CartItemSnapshot["unitPriceToman"],
    })),
  }));

export class MongoCartRepository implements CartRepository {
  private readonly connection: Connection;
  private readonly ports: CartPorts;
  private readonly now: () => Date;
  constructor(connection: Connection, ports: CartPorts, now: () => Date = () => new Date()) {
    this.connection = connection;
    this.ports = ports;
    this.now = now;
  }
  private rows() {
    return this.connection.db!.collection<Row>("carts");
  }
  async execute(
    token: string | null,
    operation: "read" | "preview" | CartMutation,
    version?: { revision: number; cartId: string },
  ): Promise<CartView> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.connection.transaction(
          (session) => this.run(token, operation, version, session),
          { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 11000 &&
          attempt < 2
        )
          continue;
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError("UNAVAILABLE", "Cart transaction unavailable", { cause: error });
      }
    }
    throw new ApplicationError("CONFLICT", "Concurrent cart creation");
  }
  private async run(
    token: string | null,
    operation: "read" | "preview" | CartMutation,
    version: { revision: number; cartId: string } | undefined,
    session: ClientSession,
  ): Promise<CartView> {
    const customer = await this.ports.authorize(token, session);
    if (
      !(await this.connection
        .db!.collection<{ _id: number }>("_schema_migrations")
        .findOne({ _id: 9 }, { session }))
    )
      throw new ApplicationError("UNAVAILABLE", "Apply cart migration 9 before use");
    const customerId = new Types.ObjectId(customer.id),
      timestamp = this.now();
    let row = await this.rows().findOne({ customerId, status: "active" }, { session });
    let expired = false;
    if (row && row.expiresAt <= timestamp) {
      await this.rows().updateOne(
        { _id: row._id, __v: row.__v },
        { $set: { status: "abandoned", updatedAt: timestamp }, $inc: { __v: 1 } },
        { session },
      );
      row = null;
      expired = true;
    }
    // TTL deletion also makes a stale revision impossible to use: mutations never recreate carts.
    if (!row && operation !== "read") {
      return {
        id: "",
        revision: 0,
        items: [],
        notes: "",
        tableNumber: null,
        expiresAt: timestamp.toISOString(),
        pricing: { subtotalToman: 0, discountToman: 0, deliveryToman: 0, totalToman: 0 },
        issues: [{ code: "CART_EXPIRED" }],
        checkoutReady: false,
        accepted: false,
      };
    }
    if (!row) {
      row = {
        _id: new Types.ObjectId(),
        customerId,
        sessionId: null,
        items: [],
        totalToman: 0,
        notes: "",
        tableNumber: null,
        status: "active",
        expiresAt: new Date(timestamp.getTime() + CART_TTL_MS),
        createdAt: timestamp,
        updatedAt: timestamp,
        __v: 0,
      };
      await this.rows().insertOne(row, { session });
    }
    const expected = typeof operation === "object" ? operation.revision : version?.revision;
    const expectedId = typeof operation === "object" ? operation.cartId : version?.cartId;
    if (operation !== "read" && expectedId !== String(row._id))
      throw new ApplicationError("CONFLICT", "Cart was replaced; reload cart");
    if (operation !== "read" && expected !== row.__v)
      throw new ApplicationError("CONFLICT", "Cart revision changed; reload cart");
    const original = readItems(row);
    let items = [...original],
      notes = row.notes,
      tableNumber = row.tableNumber ?? null,
      accepted = true;
    let pending: CartItemSnapshot | undefined;
    if (typeof operation === "object") {
      if (operation.operation === "notes") notes = operation.notes;
      else if (operation.operation === "table") tableNumber = operation.tableNumber;
      else if (operation.operation === "remove") {
        if (!items.some((i) => keyOf(i) === operation.itemKey))
          throw new ApplicationError("NOT_FOUND", "Cart item not found");
        items = items.filter((i) => keyOf(i) !== operation.itemKey);
      } else {
        const old =
          operation.operation === "update"
            ? items.find((i) => keyOf(i) === operation.itemKey)
            : undefined;
        if (operation.operation === "update" && !old)
          throw new ApplicationError("NOT_FOUND", "Cart item not found");
        const productId = operation.operation === "add" ? operation.productId : old!.productId;
        const key = cartItemKey(productId, operation.additionIds);
        const matching = items.find((i) => keyOf(i) === key && i !== old);
        const quantity = operation.quantity + (matching?.quantity ?? 0);
        if (quantity > CART_MAX_QUANTITY)
          throw new ApplicationError("VALIDATION", "Cart quantity limit exceeded");
        pending = makeCartItemSnapshot({
          productId,
          productName: "pending",
          quantity,
          note: operation.note ?? old?.note ?? matching?.note ?? "",
          basePriceToman: 0,
          additions: operation.additionIds.map((additionId) => ({
            additionId,
            name: "pending",
            priceToman: 0,
          })),
        });
        items = items.filter((i) => i !== old && i !== matching);
        items.push(pending);
      }
    }
    if (
      items.length > CART_MAX_LINES ||
      new Set([...items, ...original].map((i) => i.productId)).size > CART_MAX_LINES
    )
      throw new ApplicationError("VALIDATION", "Cart line limit exceeded");
    const catalog = await this.ports.catalog(
      [...new Set([...items, ...original].map((i) => i.productId))],
      session,
    );
    const issues: CartIssue[] = expired ? [{ code: "CART_EXPIRED" }] : [];
    if (pending) {
      const product = catalog.get(pending.productId),
        key = keyOf(pending);
      if (!product?.available) issues.push({ code: "PRODUCT_UNAVAILABLE", itemKey: key });
      for (const a of pending.additions)
        if (!product?.additions.some((current) => current.id === a.additionId && current.available))
          issues.push({ code: "ADDITION_UNAVAILABLE", itemKey: key, additionId: a.additionId });
      if (issues.length) {
        accepted = false;
        items = [...original];
        notes = row.notes;
      } else {
        const current = makeCartItemSnapshot({
          productId: pending.productId,
          productName: product!.name,
          basePriceToman: product!.basePriceToman,
          quantity: pending.quantity,
          note: pending.note,
          additions: pending.additions.map((a) => {
            const current = product!.additions.find((c) => c.id === a.additionId)!;
            return { additionId: current.id, name: current.name, priceToman: current.priceToman };
          }),
        });
        // Preserve the prior unit price for a changed-price warning on an existing selection.
        const old = original.find((i) => keyOf(i) === keyOf(current));
        items[items.indexOf(pending)] = old
          ? { ...current, unitPriceToman: old.unitPriceToman }
          : current;
      }
    }
    const priced = priceCart(items, catalog);
    issues.push(...priced.issues);
    const uniqueIssues = [
      ...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values(),
    ];
    const changed =
      typeof operation === "object" ||
      operation === "preview" ||
      JSON.stringify(original) !== JSON.stringify(priced.items);
    if (changed) {
      const result = await this.rows().updateOne(
        { _id: row._id, customerId, status: "active", __v: row.__v, expiresAt: { $gt: timestamp } },
        {
          $set: {
            items: storeItems(priced.items),
            totalToman: priced.pricing.totalToman,
            notes,
            tableNumber,
            updatedAt: timestamp,
          },
          $inc: { __v: 1 },
        },
        { session },
      );
      if (result.matchedCount !== 1)
        throw new ApplicationError("CONFLICT", "Cart revision changed");
      row.__v++;
    }
    return {
      id: String(row._id),
      revision: row.__v,
      items: priced.items,
      notes,
      tableNumber,
      expiresAt: row.expiresAt.toISOString(),
      pricing: priced.pricing,
      issues: uniqueIssues,
      checkoutReady: priced.items.length > 0 && uniqueIssues.length === 0,
      accepted,
    };
  }
}
