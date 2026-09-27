import "server-only";

import type { Schema } from "mongoose";

import { adminSchema } from "../../modules/admins/server.ts";
import { auditEventSchema } from "../../modules/audit/server.ts";
import { sessionSchema } from "../../modules/auth/server.ts";
import { cartSchema } from "../../modules/carts/server.ts";
import { categorySchema } from "../../modules/catalog/categories/server.ts";
import { productAdditionSchema, productSchema } from "../../modules/catalog/products/server.ts";
import { customerSchema } from "../../modules/customers/server.ts";
import {
  inventoryItemSchema,
  inventoryMovementSchema,
  productConsumptionRuleSchema,
  stockApprovalRequestSchema,
} from "../../modules/inventory/server.ts";
import { invoiceSchema } from "../../modules/invoices/server.ts";
import { mediaAssetSchema } from "../../modules/media/server.ts";
import { outboxEventSchema } from "../../modules/notifications/server.ts";
import { orderSchema } from "../../modules/orders/server.ts";
import { transactionSchema } from "../../modules/payments/server.ts";
import { printJobSchema } from "../../modules/printing/server.ts";
import { settingsSchema } from "../../modules/settings/server.ts";

const schemas = [
  adminSchema,
  customerSchema,
  sessionSchema,
  mediaAssetSchema,
  categorySchema,
  productSchema,
  productAdditionSchema,
  cartSchema,
  transactionSchema,
  orderSchema,
  inventoryItemSchema,
  productConsumptionRuleSchema,
  inventoryMovementSchema,
  stockApprovalRequestSchema,
  invoiceSchema,
  printJobSchema,
  settingsSchema,
  auditEventSchema,
  outboxEventSchema,
];

export const businessIndexes = schemas.flatMap((schema: Schema) => {
  const collection = schema.get("collection") as string | undefined;
  if (!collection) throw new Error("Business schema needs an explicit collection name");
  return schema.indexes().map(([keys, options]) => {
    if (!options.name) throw new Error(`Unnamed index on ${collection}`);
    return { collection, keys, name: options.name, options };
  });
});
