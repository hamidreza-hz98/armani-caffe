import "server-only";

import { type Connection, Types } from "mongoose";

import { customerCookieName, validCustomerToken } from "@/modules/auth";
import type { OrderView } from "@/modules/orders";
import type { OrderService } from "@/modules/orders/server";
import type { PaymentIssue } from "@/modules/payments";
import { getDatabaseConnection } from "@/server/database/connection";
import { getServerConfig } from "@/server/secrets/config";
import type { CustomerPayment, PaymentResult } from "@/storefront/payment-result";

import { composeOrderService } from "./orders";

export function customerTokenFromCookies(values: {
  get(name: string): { value: string } | undefined;
}) {
  const config = getServerConfig();
  const value = values.get(customerCookieName(config.mode === "production"))?.value;
  return validCustomerToken(value) ? value : null;
}

export async function customerOrderDetail(token: string, id: string): Promise<OrderView> {
  const config = getServerConfig();
  const connection = await getDatabaseConnection();
  return composeOrderService(connection, {
    customerSessionSecret: config.auth.sessionSecret,
    adminSessionSecret: config.auth.adminSessionSecret,
  }).service.detail(token, id, true);
}

export async function customerPaymentResult(token: string, id: string): Promise<PaymentResult> {
  const config = getServerConfig();
  const connection = await getDatabaseConnection();
  const service = composeOrderService(connection, {
    customerSessionSecret: config.auth.sessionSecret,
    adminSessionSecret: config.auth.adminSessionSecret,
  }).service;
  return readCustomerPaymentResult(connection, service, token, id);
}

/** Exported for database integration tests with an isolated connection. */
export async function readCustomerPaymentResult(
  connection: Connection,
  service: OrderService,
  token: string,
  id: string,
): Promise<PaymentResult> {
  // Authorize the checkout before looking up even a status or transaction timestamp.
  const checkout = await service.checkoutView(token, id);
  const row = await connection
    .db!.collection<{
      status: CustomerPayment["status"];
      issue: PaymentIssue;
      amountToman: number;
      providerReference: string | null;
      updatedAt: Date;
    }>("transactions")
    .findOne(
      { orderId: new Types.ObjectId(checkout.id) },
      {
        projection: { status: 1, issue: 1, amountToman: 1, providerReference: 1, updatedAt: 1 },
        sort: { createdAt: -1 },
      },
    );
  const payment: CustomerPayment | null = row
    ? {
        status: row.status,
        issue: row.issue,
        amountToman: row.amountToman,
        reference: row.providerReference,
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;
  const order =
    checkout.state === "CONFIRMED" && checkout.orderId
      ? await service.detail(token, checkout.orderId, true)
      : null;
  return { checkout, payment, order };
}
