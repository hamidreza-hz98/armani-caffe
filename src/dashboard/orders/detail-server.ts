import "server-only";

import { Types } from "mongoose";

import type { IssuedInvoice } from "@/modules/invoices";
import type { OrderView } from "@/modules/orders";
import { MongoPrintJobs, type PrintJobView } from "@/modules/printing/server";
import { composeInvoiceRepository } from "@/server/commerce/invoices";
import { composeOrderService } from "@/server/commerce/orders";
import { getDatabaseConnection } from "@/server/database/connection";
import { getServerConfig } from "@/server/secrets/config";
import { ApplicationError } from "@/shared/errors";

export type OrderDetailData = {
  order: OrderView;
  invoice: IssuedInvoice | null;
  printJobs: PrintJobView[];
  transaction: {
    status: string;
    issue: string | null;
    amountToman: number;
    settledAt: string | null;
  } | null;
  stock: {
    id: string;
    name: string;
    delta: number;
    unit: string;
    reason: string;
    before: number;
    after: number;
    at: string;
  }[];
  activity: {
    id: string;
    action: string;
    area: string;
    actorKind: string;
    at: string;
  }[];
};

export async function orderDetailData(token: string | null, id: string): Promise<OrderDetailData> {
  if (!/^[a-f\d]{24}$/u.test(id)) throw new ApplicationError("VALIDATION", "Invalid order ID");
  const connection = await getDatabaseConnection();
  const config = getServerConfig();
  const keys = {
    customerSessionSecret: config.auth.sessionSecret,
    adminSessionSecret: config.auth.adminSessionSecret,
  };
  // The service authorizes orders.read before any associated data is queried.
  const order = await composeOrderService(connection, keys).service.detail(token, id, false);
  let invoice: IssuedInvoice | null = null;
  try {
    invoice = await composeInvoiceRepository(connection, keys).read(token, id, false);
  } catch (error) {
    if (
      !(error instanceof ApplicationError) ||
      (error.code !== "NOT_FOUND" && error.code !== "UNAVAILABLE")
    )
      throw error;
  }
  const orderId = new Types.ObjectId(id);
  const invoiceId = invoice ? new Types.ObjectId(invoice.id) : null;
  const transactionId = new Types.ObjectId(order.transaction.id);
  const db = connection.db!;
  const [printJobs, movements, audit, transaction] = await Promise.all([
    new MongoPrintJobs(connection).byOrder(id),
    db
      .collection<{
        _id: Types.ObjectId;
        inventoryItemId: Types.ObjectId;
        delta: number;
        unit: string;
        reason: string;
        before: number;
        after: number;
        createdAt: Date;
      }>("inventory_movements")
      .find(
        { orderId },
        {
          projection: {
            inventoryItemId: 1,
            delta: 1,
            unit: 1,
            reason: 1,
            before: 1,
            after: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .maxTimeMS(2500)
      .toArray(),
    db
      .collection<{
        _id: Types.ObjectId;
        area: string;
        action: string;
        actor: { kind: string };
        occurredAt: Date;
      }>("audit_events")
      .find(
        {
          $or: [
            { "subject.kind": "order", "subject.id": id },
            { "subject.kind": "transaction", "subject.id": order.transaction.id },
            ...(invoiceId ? [{ "subject.kind": "invoice", "subject.id": invoice!.id }] : []),
          ],
        },
        { projection: { area: 1, action: 1, actor: 1, occurredAt: 1 } },
      )
      .sort({ occurredAt: -1, _id: -1 })
      .limit(30)
      .maxTimeMS(2500)
      .toArray(),
    db
      .collection<{
        status: string;
        issue: string | null;
        amountToman: number;
        settledAt: Date | null;
      }>("transactions")
      .findOne(
        { _id: transactionId },
        { projection: { status: 1, issue: 1, amountToman: 1, settledAt: 1 }, maxTimeMS: 2500 },
      ),
  ]);
  const inventoryIds = [...new Set(movements.map((item) => String(item.inventoryItemId)))].map(
    (value) => new Types.ObjectId(value),
  );
  const inventory = inventoryIds.length
    ? await db
        .collection<{ _id: Types.ObjectId; name: string }>("inventory_items")
        .find({ _id: { $in: inventoryIds } }, { projection: { name: 1 } })
        .limit(100)
        .maxTimeMS(2500)
        .toArray()
    : [];
  const names = new Map(inventory.map((item) => [String(item._id), item.name]));
  return {
    order,
    invoice,
    printJobs,
    transaction: transaction
      ? {
          status: transaction.status,
          issue: transaction.issue,
          amountToman: transaction.amountToman,
          settledAt: transaction.settledAt?.toISOString() ?? null,
        }
      : null,
    stock: movements.map((movement) => ({
      id: String(movement._id),
      name: names.get(String(movement.inventoryItemId)) ?? "قلم موجودی",
      delta: movement.delta,
      unit: movement.unit,
      reason: movement.reason,
      before: movement.before,
      after: movement.after,
      at: movement.createdAt.toISOString(),
    })),
    activity: audit.map((item) => ({
      id: String(item._id),
      action: item.action,
      area: item.area,
      actorKind: item.actor.kind,
      at: item.occurredAt.toISOString(),
    })),
  };
}
