import "server-only";

import { type Connection, Types } from "mongoose";

import type { ClaimedOutbox } from "../../modules/notifications/server.ts";
import { MongoPrintJobs } from "../../modules/printing/server.ts";
import type { PrintSchedule } from "../queue/index.ts";

const oid = (value: string) => new Types.ObjectId(value);
function eventId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/u.test(value))
    throw new Error("Invalid print outbox identity");
  return value;
}
export function printOutboxHandlers(
  connection: Connection,
  schedule: PrintSchedule,
  fallbackPrinterId: string,
  now: () => Date = () => new Date(),
) {
  const jobs = new MongoPrintJobs(connection, now);
  const handle = async (event: ClaimedOutbox) => {
    const invoiceId = eventId(event.payload.invoiceId);
    const invoice = await connection
      .db!.collection<{
        _id: Types.ObjectId;
        orderId: Types.ObjectId;
        paperWidthMm: 58 | 80;
        printing?: { automatic: boolean; printerId: string };
      }>("invoices")
      .findOne({ _id: oid(invoiceId) });
    if (!invoice) throw new Error("Invoice missing for print event");
    const automatic = event.eventType === "invoice.issued";
    if (automatic && !invoice.printing?.automatic) return;
    const reprintId = automatic ? undefined : eventId(event.payload.reprintId);
    const reprint = reprintId
      ? await connection
          .db!.collection<{
            _id: Types.ObjectId;
            invoiceId: Types.ObjectId;
            orderId: Types.ObjectId;
            paperWidthMm: 58 | 80;
          }>("invoice_reprints")
          .findOne({ _id: oid(reprintId) })
      : null;
    if (
      reprintId &&
      (!reprint ||
        String(reprint.invoiceId) !== invoiceId ||
        String(reprint.orderId) !== String(invoice.orderId))
    )
      throw new Error("Invalid reprint link");
    const job = await jobs.create({
      invoiceId,
      orderId: String(invoice.orderId),
      source: automatic ? "automatic" : "reprint",
      ...(reprintId ? { reprintId } : {}),
      printerId: invoice.printing?.printerId || fallbackPrinterId,
      paperWidthMm: reprint?.paperWidthMm ?? invoice.paperWidthMm,
    });
    if (job.status === "queued" && job.nextAttemptAt)
      await schedule.schedule(job.id, new Date(job.nextAttemptAt));
  };
  return { "invoice.issued": handle, "invoice.reprint_requested": handle };
}
