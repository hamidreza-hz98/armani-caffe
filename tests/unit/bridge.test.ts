import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { FilePrinter, OutputUncertainError, type PrinterAdapter } from "../../bridge/adapters.ts";
import { PrintBridge } from "../../bridge/client.ts";
import { PrintJournal } from "../../bridge/journal.ts";
import { parsePrintDelivery, type PrintDelivery } from "../../bridge/protocol.ts";

const temporary: string[] = [];
const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), "armani-bridge-"));
  temporary.push(path);
  return path;
};
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
const delivery = (attempt = 1): PrintDelivery => ({
  v: 1,
  type: "print.job",
  jobId: "0123456789abcdef01234567",
  invoiceId: "abcdef0123456789abcdef01",
  printerId: "cafe-counter",
  attempt,
  deliveryId: "12345678-1234-1234-1234-123456789012",
  paperWidthMm: 58,
  html: '<!doctype html><html lang="fa" dir="rtl"><style>data:font/woff2;base64,AAAA</style></html>',
});
const bridge = (path: string, adapter: PrinterAdapter) =>
  new PrintBridge(
    {
      url: "ws://127.0.0.1:3001/ws?role=bridge",
      printerId: "cafe-counter",
      token: "test_printer_bridge_token_32_characters",
      journalDirectory: join(path, "journal"),
    },
    adapter,
    async () => Uint8Array.from([27, 64, 10]),
    () => undefined,
  );

test("protocol rejects cross-printer and malformed jobs", () => {
  expect(parsePrintDelivery(JSON.stringify(delivery()), "cafe-counter")).toEqual(delivery());
  expect(() => parsePrintDelivery(JSON.stringify(delivery()), "other")).toThrow(
    "INVALID_PRINT_JOB",
  );
  expect(() => parsePrintDelivery(JSON.stringify({ ...delivery(), v: 2 }), "cafe-counter")).toThrow(
    "UNSUPPORTED_PROTOCOL",
  );
  expect(() =>
    parsePrintDelivery(JSON.stringify({ ...delivery(), token: "secret" }), "cafe-counter"),
  ).toThrow("INVALID_PRINT_JOB");
});

test("journal survives restart and simulator writes one ESC/POS receipt", async () => {
  const path = await directory();
  const first = bridge(path, new FilePrinter(join(path, "out")));
  await first.handle(delivery());
  expect((await first.journal.read(delivery().jobId))?.state).toBe("printed");
  expect([...(await readFile(join(path, "out", `${delivery().jobId}.escpos`)))]).toEqual([
    27, 64, 10,
  ]);
  const restarted = bridge(path, new FilePrinter(join(path, "out")));
  await restarted.handle(delivery(2));
  expect(await restarted.journal.list()).toHaveLength(1);
  expect((await restarted.journal.read(delivery().jobId))?.state).toBe("printed");
});

test("failed adapter can retry, while ambiguous received state requires operator review", async () => {
  const path = await directory();
  let prints = 0;
  const adapter: PrinterAdapter = {
    async print() {
      prints++;
      if (prints === 1) throw new Error("PAPER_OUT");
    },
  };
  const worker = bridge(path, adapter);
  await worker.handle(delivery());
  expect((await worker.journal.read(delivery().jobId))?.state).toBe("failed");
  await worker.handle(delivery(2));
  expect(prints).toBe(2);
  expect((await worker.journal.read(delivery().jobId))?.state).toBe("printed");
  const uncertain = new PrintJournal(join(path, "uncertain"));
  await uncertain.write({
    jobId: delivery().jobId,
    invoiceId: delivery().invoiceId,
    attempt: 1,
    deliveryId: delivery().deliveryId,
    state: "received",
    updatedAt: new Date().toISOString(),
  });
  const cautious = bridge(path, adapter);
  await cautious.journal.write((await uncertain.read(delivery().jobId))!);
  await cautious.handle(delivery(3));
  expect(prints).toBe(2);
});

test("uncertain transport outcome stays received and never auto-reprints", async () => {
  const path = await directory();
  let prints = 0;
  const worker = bridge(path, {
    async print() {
      prints++;
      throw new OutputUncertainError();
    },
  });
  await worker.handle(delivery());
  await worker.handle(delivery(2));
  expect(prints).toBe(1);
  expect((await worker.journal.read(delivery().jobId))?.state).toBe("received");
});

test("journal lock prevents a second local bridge and reopens after clean stop", async () => {
  const path = join(await directory(), "journal");
  const first = new PrintJournal(path);
  const second = new PrintJournal(path);
  await first.lock();
  await expect(second.lock()).rejects.toThrow("BRIDGE_ALREADY_RUNNING");
  await first.unlock();
  await second.lock();
  await second.unlock();
});
