import { randomUUID } from "node:crypto";

const command = process.argv[2];
if (command !== "work" && command !== "replay") {
  throw new Error("Use work or replay <event-id> --apply");
}
if (command === "replay") {
  if (!/^[a-f0-9]{24}$/i.test(process.argv[3] ?? "") || !process.argv.includes("--apply")) {
    throw new Error("Replay requires a 24-character event ID and explicit --apply");
  }
}

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
process.env.NODE_ENV ??= "development";

const { getServerConfig } = await import("../src/server/secrets/config.ts");
getServerConfig();
const { getDatabaseConnection, closeDatabaseConnection } =
  await import("../src/server/database/connection.ts");
const { OutboxWorker, replayOutbox } = await import("../src/modules/notifications/server.ts");
const connection = await getDatabaseConnection();

if (command === "replay") {
  try {
    const replayed = await replayOutbox(connection, process.argv[3], new Date());
    console.log(
      replayed
        ? "Event requeued with its original idempotency key."
        : "No dead/delivered event matched the ID.",
    );
  } finally {
    await closeDatabaseConnection();
  }
} else {
  const { installShutdownHandlers, registerResource } =
    await import("../src/server/lifecycle/index.ts");
  installShutdownHandlers();
  const controller = new AbortController();
  registerResource("outbox-worker", async () => {
    controller.abort();
  });
  const worker = new OutboxWorker(connection, {}, { workerId: `outbox-${randomUUID()}` });
  console.log(
    "Outbox worker started without delivery handlers. It will not claim events until handlers are registered.",
  );
  await worker.run(controller.signal);
}
