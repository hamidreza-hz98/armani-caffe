import {
  asToman,
  type EntityDto,
  type TomanAmount,
  type UtcTimestamp,
} from "../../../shared/domain.ts";

export type InvoiceLineSnapshot = Readonly<{
  productName: string;
  categoryName: string;
  additions: readonly { name: string; priceToman: TomanAmount }[];
  quantity: number;
  note: string;
  unitPriceToman: TomanAmount;
  lineTotalToman: TomanAmount;
}>;
export type Invoice = EntityDto &
  Readonly<{
    orderId: string;
    snapshotVersion: 1;
    number: string;
    lines: readonly InvoiceLineSnapshot[];
    totalToman: TomanAmount;
    issuedAt: UtcTimestamp;
    status: "issued" | "voided";
    voidedAt: UtcTimestamp | null;
  }>;

export function assertInvoiceTransition(from: Invoice["status"], to: Invoice["status"]): void {
  if (from !== "issued" || to !== "voided") {
    throw new RangeError(`Invalid invoice transition: ${from} -> ${to}`);
  }
}

export function makeInvoiceLines(
  items: readonly {
    productName: string;
    categoryName: string;
    quantity: number;
    note?: string;
    unitPriceToman: number;
    lineTotalToman: number;
    additions: readonly { name: string; priceToman: number }[];
  }[],
): readonly InvoiceLineSnapshot[] {
  if (items.length === 0) throw new RangeError("Invoice needs at least one item");
  return Object.freeze(
    items.map((item) => {
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1)
        throw new RangeError("Invalid invoice quantity");
      const additions = Object.freeze(
        item.additions.map((addition) =>
          Object.freeze({ name: addition.name, priceToman: asToman(addition.priceToman) }),
        ),
      );
      return Object.freeze({
        productName: item.productName,
        categoryName: item.categoryName,
        additions,
        quantity: item.quantity,
        note: item.note ?? "",
        unitPriceToman: asToman(item.unitPriceToman),
        lineTotalToman: asToman(item.lineTotalToman),
      });
    }),
  );
}
