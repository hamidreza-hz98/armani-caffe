import { resolve } from "node:path";

import {
  FilePrinter,
  NetworkPrinter,
  type PrinterAdapter,
  WindowsSpoolPrinter,
} from "./adapters.ts";
import { PrintBridge } from "./client.ts";
import { PrintJournal } from "./journal.ts";
import { ReceiptRenderer } from "./receipt.ts";

try {
  process.loadEnvFile(".env.bridge.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const command = process.argv[2] ?? "run";
const dataDirectory = resolve(process.env.BRIDGE_DATA_DIR ?? "./data/print-bridge");
const journal = new PrintJournal(resolve(dataDirectory, "journal"));
const log = (event: string, fields: Record<string, string | number | boolean> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));

if (command === "status") {
  const entries = await journal.list();
  const counts = Object.fromEntries(
    ["received", "failed", "printed", "acknowledged"].map((state) => [
      state,
      entries.filter((entry) => entry.state === state).length,
    ]),
  );
  console.log(JSON.stringify({ journalDirectory: journal.directory, counts, entries }, null, 2));
} else if (command === "resolve") {
  const jobId = process.argv[3];
  const decision = process.argv[4];
  if (!jobId || !["printed", "retry"].includes(decision ?? "") || process.argv[5] !== "--confirm")
    throw new Error("Usage: npm run bridge:resolve -- <job-id> printed|retry --confirm");
  await journal.lock();
  try {
    const entry = await journal.read(jobId);
    if (!entry || entry.state !== "received")
      throw new Error("Only ambiguous received jobs can be resolved");
    await journal.write({
      ...entry,
      state: decision === "printed" ? "printed" : "failed",
      updatedAt: new Date().toISOString(),
      ...(decision === "retry" ? { errorCode: "OPERATOR_RETRY" } : {}),
    });
    log("operator_resolution", { jobId, decision: decision! });
  } finally {
    await journal.unlock();
  }
} else if (command === "run" || command === "doctor") {
  const url = process.env.BRIDGE_REALTIME_URL;
  const printerId = process.env.BRIDGE_PRINTER_ID;
  const token = process.env.BRIDGE_TOKEN;
  const mode = process.env.BRIDGE_ADAPTER ?? "file";
  if (!url || !printerId || !token) throw new Error("Missing bridge URL, printer ID, or token");
  const parsed = new URL(url);
  if (
    !["ws:", "wss:"].includes(parsed.protocol) ||
    parsed.search !== "?role=bridge" ||
    (parsed.protocol === "ws:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) ||
    !/^[a-zA-Z0-9_-]{1,64}$/u.test(printerId) ||
    token.length < 32 ||
    !["file", "network", "windows-spool"].includes(mode)
  )
    throw new Error("Invalid bridge configuration; remote connections require WSS");
  let adapter: PrinterAdapter;
  if (mode === "network") {
    const host = process.env.BRIDGE_NETWORK_HOST;
    const port = Number(process.env.BRIDGE_NETWORK_PORT ?? "9100");
    if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid network printer target");
    adapter = new NetworkPrinter(host, port);
  } else if (mode === "windows-spool") {
    if (process.platform !== "win32" || !process.env.BRIDGE_WINDOWS_PRINTER)
      throw new Error("Windows printer name required on Windows");
    adapter = new WindowsSpoolPrinter(
      process.env.BRIDGE_WINDOWS_PRINTER,
      resolve(dataDirectory, "scratch"),
    );
  } else adapter = new FilePrinter(resolve(dataDirectory, "simulated"));
  if (command === "doctor") {
    log("doctor", {
      url: `${parsed.origin}${parsed.pathname}`,
      printerId,
      adapter: mode,
      journalDirectory: journal.directory,
    });
  } else {
    const renderer = new ReceiptRenderer(process.env.BRIDGE_BROWSER_CHANNEL);
    const bridge = new PrintBridge(
      { url, printerId, token, journalDirectory: journal.directory },
      adapter,
      (job) => renderer.render(job),
      log,
    );
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    process.once("SIGTERM", () => controller.abort());
    try {
      await bridge.run(controller.signal);
    } finally {
      await renderer.close();
    }
  }
} else throw new Error("Bridge commands: run, status, doctor, resolve");
