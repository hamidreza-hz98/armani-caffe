import { randomUUID, timingSafeEqual } from "node:crypto";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
process.env.NODE_ENV ??= "development";

const { getServerConfig } = await import("../src/server/secrets/config.ts");
const config = getServerConfig();
const { getDatabaseConnection } = await import("../src/server/database/connection.ts");
const { createPrintRedis, PrintDispatcher, registerQueueCloser } =
  await import("../src/server/queue/index.ts");
const { startPrintRealtime, registerRealtimeCloser } =
  await import("../src/server/realtime/index.ts");
const { MongoPrintJobs } = await import("../src/modules/printing/server.ts");
const { OutboxWorker } = await import("../src/modules/notifications/server.ts");
const { printOutboxHandlers } = await import("../src/server/commerce/print-outbox.ts");
const { composeInvoiceRepository } = await import("../src/server/commerce/invoices.ts");
const { receiptFontDataUrl } = await import("../src/server/commerce/invoice-font.ts");
const { renderInvoiceHtml } = await import("../src/modules/invoices/index.ts");
const { createAdminSecurity, readAdminCookie } = await import("../src/modules/auth/server.ts");
const { createSettingsRepository, SettingsVault } =
  await import("../src/modules/settings/server.ts");
const { installShutdownHandlers, registerResource } =
  await import("../src/server/lifecycle/index.ts");

const connection = await getDatabaseConnection();
if (!(await connection.db.collection("_schema_migrations").findOne({ _id: 13 })))
  throw new Error("Apply migration 13 and print-job indexes before starting realtime");
const prefix =
  process.env.NODE_ENV === "test" ? (process.env.TEST_REDIS_PREFIX ?? "armani-test") : "armani";
const schedule = await createPrintRedis(config.redisUrl, prefix);
registerQueueCloser(() => schedule.close());
const jobs = new MongoPrintJobs(connection);
const invoices = composeInvoiceRepository(connection, {
  customerSessionSecret: config.auth.sessionSecret,
  adminSessionSecret: config.auth.adminSessionSecret,
});
const admin = createAdminSecurity(connection, config.auth.adminSessionSecret);
const settings = createSettingsRepository(
  connection,
  new SettingsVault(config.encryption.key, config.encryption.previousKey),
);
const matches = (a, b) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const realtime = await startPrintRealtime({
  port: config.webSocket.port,
  path: config.webSocket.path,
  heartbeatMs: config.webSocket.heartbeatMs,
  origins: [new URL(config.appUrl).origin, new URL(config.adminUrl).origin],
  authorizeBridge: (printerId, token) =>
    settings.withCredentials("printing", async (values, secrets) =>
      values.enabled
        ? printerId === values.bridgeId && matches(token, secrets.bridgeToken ?? "")
        : printerId === config.printerBridge.id && matches(token, config.printerBridge.token),
    ),
  schedule,
  jobs,
  authenticateAdmin: async (cookie) => {
    const token = readAdminCookie(
      new Request("http://localhost", { headers: { cookie: cookie ?? "" } }),
      config.mode === "production",
    );
    try {
      await admin.store.authorize(token, "printing.read");
      return true;
    } catch {
      return false;
    }
  },
  authenticateOrders: async (cookie) => {
    const token = readAdminCookie(
      new Request("http://localhost", { headers: { cookie: cookie ?? "" } }),
      config.mode === "production",
    );
    try {
      await admin.store.authorize(token, "orders.read");
      return true;
    } catch {
      return false;
    }
  },
  payload: async (job) => {
    const invoice = await invoices.onOrderConfirmed(job.orderId);
    if (invoice.id !== job.invoiceId) throw new Error("Print job invoice mismatch");
    return {
      jobId: job.id,
      invoiceId: job.invoiceId,
      printerId: job.printerId,
      attempt: job.attempts,
      deliveryId: job.deliveryId,
      paperWidthMm: job.paperWidthMm,
      html: renderInvoiceHtml(invoice, job.paperWidthMm, await receiptFontDataUrl()),
    };
  },
});
registerRealtimeCloser(() => realtime.close());
const dispatcher = new PrintDispatcher(jobs, schedule, realtime.deliver, realtime.available);
const outbox = new OutboxWorker(
  connection,
  {
    ...printOutboxHandlers(connection, schedule, config.printerBridge.id),
    ...Object.fromEntries(
      [
        "order.confirmed",
        "order.preparing",
        "order.ready",
        "order.completed",
        "order.cancelled",
        "order.refunded",
      ].map((type) => [
        type,
        async (event) => {
          const orderId = event.payload?.orderId;
          if (typeof orderId !== "string" || !/^[a-f\d]{24}$/iu.test(orderId))
            throw new Error("Invalid order outbox payload");
          realtime.broadcastOrder({
            eventId: String(event.id),
            orderId,
            change: type,
            at: new Date().toISOString(),
          });
        },
      ]),
    ),
  },
  { workerId: `print-${randomUUID()}` },
);
const controller = new AbortController();
installShutdownHandlers();
registerResource("print-loops", async () => {
  controller.abort();
});
await dispatcher.reconcile();
console.log(
  `Realtime print service listening on 127.0.0.1:${config.webSocket.port}${config.webSocket.path}`,
);
await Promise.all([dispatcher.run(controller.signal), outbox.run(controller.signal)]);
