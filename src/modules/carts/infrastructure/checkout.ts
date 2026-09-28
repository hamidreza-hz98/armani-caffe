import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import type { CartItemSnapshot } from "../domain/model.ts";
export function cartCheckoutPort(connection: Connection, now: () => Date = () => new Date()) {
  const rows = () => connection.db!.collection("carts");
  return {
    read: async (session: ClientSession, id: string, customerId: string, revision: number) => {
      const row = await rows().findOne(
        {
          _id: new Types.ObjectId(id),
          customerId: new Types.ObjectId(customerId),
          status: "active",
          __v: revision,
          expiresAt: { $gt: now() },
        },
        { session },
      );
      if (!row) throw new ApplicationError("CONFLICT", "Cart expired, changed, or unavailable");
      return {
        items: row.items.map(
          (i: {
            productId: Types.ObjectId;
            additions: { additionId: Types.ObjectId; name: string; priceToman: number }[];
            quantity: number;
            productName: string;
            unitPriceToman: number;
            lineTotalToman: number;
          }) => ({
            ...i,
            productId: String(i.productId),
            additions: i.additions.map((a) => ({ ...a, additionId: String(a.additionId) })),
          }),
        ) as CartItemSnapshot[],
        notes: String(row.notes ?? ""),
      };
    },
    freeze: async (
      session: ClientSession,
      id: string,
      customerId: string,
      revision: number,
      checkoutId: string,
    ) => {
      const result = await rows().updateOne(
        {
          _id: new Types.ObjectId(id),
          customerId: new Types.ObjectId(customerId),
          status: "active",
          __v: revision,
          expiresAt: { $gt: now() },
        },
        {
          $set: {
            status: "payment_pending",
            checkoutId: new Types.ObjectId(checkoutId),
            updatedAt: now(),
          },
          $unset: { expiresAt: "" },
          $inc: { __v: 1 },
        },
        { session },
      );
      if (result.matchedCount !== 1) throw new ApplicationError("CONFLICT", "Cart freeze conflict");
    },
    available: async (session: ClientSession, cartId: string, checkoutId: string) =>
      !!(await rows().findOne(
        {
          _id: new Types.ObjectId(cartId),
          status: "payment_pending",
          checkoutId: new Types.ObjectId(checkoutId),
        },
        { session, projection: { _id: 1 } },
      )),
    close: async (session: ClientSession, cartId: string, checkoutId: string) => {
      const result = await rows().updateOne(
        {
          _id: new Types.ObjectId(cartId),
          status: "payment_pending",
          checkoutId: new Types.ObjectId(checkoutId),
        },
        {
          $set: {
            status: "checked_out",
            items: [],
            totalToman: 0,
            expiresAt: new Date(now().getTime() + 24 * 60 * 60 * 1000),
            updatedAt: now(),
          },
          $inc: { __v: 1 },
        },
        { session },
      );
      if (result.matchedCount !== 1)
        throw new ApplicationError("CONFLICT", "Frozen cart close conflict");
    },
  };
}
