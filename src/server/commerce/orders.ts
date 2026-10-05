import "server-only";

import { randomUUID } from "node:crypto";

import type { Connection } from "mongoose";

import { appendAudit } from "../../modules/audit/server.ts";
import { createAdminSecurity, createCustomerSecurity } from "../../modules/auth/server.ts";
import { priceCart } from "../../modules/carts/index.ts";
import { cartCheckoutPort } from "../../modules/carts/server.ts";
import { productPricingProjection } from "../../modules/catalog/products/server.ts";
import { MongoCustomerRepository } from "../../modules/customers/server.ts";
import { createInventoryService, productStockProjection } from "../../modules/inventory/server.ts";
import { appendOutbox } from "../../modules/notifications/server.ts";
import { makeOrderItemSnapshot, type StockLine } from "../../modules/orders/index.ts";
import {
  MongoOrderRepository,
  type OrderPorts,
  OrderService,
} from "../../modules/orders/server.ts";
import { paymentReceipt } from "../../modules/payments/server.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { composeInvoiceRepository } from "./invoices.ts";
export function composeOrderService(
  connection: Connection,
  keys: { customerSessionSecret: string; adminSessionSecret: string },
  now: () => Date = () => new Date(),
) {
  const customer = createCustomerSecurity(connection, keys.customerSessionSecret, now),
    admin = createAdminSecurity(connection, keys.adminSessionSecret, now);
  const authorize: OrderPorts["admin"] = (token, capability, session) =>
    admin.store.authorize(token, capability, session);
  const inventory = createInventoryService(connection, authorize, now).repository;
  const invoices = composeInvoiceRepository(connection, keys, now);
  const cart = cartCheckoutPort(connection, now),
    customers = new MongoCustomerRepository(connection, now);
  const ports: OrderPorts = {
    customer: (token, session) => customer.store.authorize(token, session),
    admin: authorize,
    freeze: cart.freeze,
    available: cart.available,
    close: cart.close,
    receipt: (session, id) => paymentReceipt(connection, session, id),
    canConsume: (session, stock) => inventory.canConsumeOrder(session, stock),
    consume: (session, id, stock, requestId) =>
      inventory.consumeOrder(session, id, stock, requestId),
    reverse: (session, id, requestId) => inventory.reverseOrder(session, id, requestId),
    invoice: async (session, order, requestId) => {
      await invoices.issueInside(session, order, requestId);
    },
    quote: async (session, customerId, cartId, revision) => {
      const source = await cart.read(session, cartId, customerId, revision);
      const ids = [...new Set(source.items.map((i) => i.productId))];
      const catalog = await productPricingProjection(connection, ids, session),
        stocks = await productStockProjection(connection, session, ids);
      const enriched = new Map(
        [...catalog].map(([id, product]) => [
          id,
          {
            ...product,
            available: product.available && !!stocks.get(id)?.orderable,
            stock: stocks.get(id)?.availability ?? [],
          },
        ]),
      );
      const priced = priceCart(source.items, enriched);
      if (!priced.checkoutReady)
        throw new ApplicationError("CONFLICT", "Cart needs a fresh checkout preview");
      const stock = new Map<string, StockLine>();
      const items = priced.items.map((item) => {
        const product = catalog.get(item.productId)!;
        for (const rule of stocks.get(item.productId)!.rules) {
          const prior = stock.get(rule.inventoryItemId),
            quantity = (prior?.quantity ?? 0) + rule.quantity * item.quantity;
          if (
            !Number.isSafeInteger(quantity) ||
            quantity < 1 ||
            !["gram", "milliliter", "piece"].includes(rule.unit) ||
            (prior && prior.unit !== rule.unit)
          )
            throw new ApplicationError("VALIDATION", "Invalid stock manifest");
          stock.set(rule.inventoryItemId, {
            inventoryItemId: rule.inventoryItemId,
            quantity,
            unit: rule.unit as StockLine["unit"],
          });
        }
        return makeOrderItemSnapshot({
          ...item,
          categoryName: product.categoryName,
          basePriceToman: product.basePriceToman,
        });
      });
      if (stock.size > 200)
        throw new ApplicationError("VALIDATION", "Stock manifest exceeds bound");
      return {
        customer: await customers.orderSnapshot(customerId, session),
        items,
        pricing: priced.pricing,
        stock: [...stock.values()].sort((a, b) =>
          a.inventoryItemId.localeCompare(b.inventoryItemId),
        ),
        notes: source.notes,
        tableNumber: source.tableNumber,
      };
    },
    record: async (session, id, event, requestId, actor) => {
      const idempotencyKey = `order:${randomUUID()}`;
      await appendAudit(
        connection,
        session,
        {
          actor,
          area: "order",
          action: event,
          subject: { kind: "order", id },
          requestId,
          idempotencyKey,
          metadata: {},
        },
        now(),
      );
      await appendOutbox(
        connection,
        session,
        [
          {
            actor,
            aggregateKind: "order",
            aggregateId: id,
            eventType: event,
            requestId,
            idempotencyKey,
            payload: { orderId: id },
          },
          ...(["order.confirmed", "order.cancelled"].includes(event)
            ? [
                {
                  actor,
                  aggregateKind: "catalog",
                  aggregateId: id,
                  eventType: "catalog.orders.changed",
                  requestId,
                  idempotencyKey: `${idempotencyKey}:catalog`,
                  payload: { orderId: id },
                },
              ]
            : []),
        ],
        now(),
      );
    },
  };
  const repository = new MongoOrderRepository(connection, ports, now);
  return { service: new OrderService(repository), repository };
}
