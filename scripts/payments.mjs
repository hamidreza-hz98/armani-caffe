import { randomUUID } from "node:crypto";
const args = process.argv.slice(2),
  command = args[0],
  id = args[args.indexOf("--id") + 1];
if (
  !["inquire", "fake:settle"].includes(command) ||
  !args.includes("--apply") ||
  !args.includes("--id") ||
  !/^[a-f\d]{24}$/.test(id ?? "")
)
  throw new Error("Use inquire or fake:settle --id <transaction ID> --apply");
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
process.env.NODE_ENV ??= "development";
const { getServerConfig } = await import("../src/server/secrets/config.ts");
const config = getServerConfig();
if (
  command === "fake:settle" &&
  (config.mode === "production" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(config.mongodbUri).hostname))
)
  throw new Error("Fake settlement is restricted to non-production loopback databases");
const { getDatabaseConnection, closeDatabaseConnection } =
  await import("../src/server/database/connection.ts");
const { configuredPaymentFramework } = await import("../src/server/commerce/payments.ts");
const { MongoFakeLedger } = await import("../src/modules/payments/server.ts");
const { Types } = await import("mongoose");
try {
  if (command === "fake:settle") {
    const outcome = args[args.indexOf("--outcome") + 1];
    if (
      !args.includes("--outcome") ||
      !["success", "failed", "pending", "unknown"].includes(outcome)
    )
      throw new Error("Choose --outcome success, failed, pending, or unknown");
    const connection = await getDatabaseConnection();
    const row = await connection.db.collection("transactions").findOne({
      _id: new Types.ObjectId(id),
      provider: "fake",
      status: "pending",
      frameworkVersion: 1,
    });
    if (!row?.authority) throw new Error("No pending fake transaction with this ID");
    await new MongoFakeLedger(connection).outcome(
      row.authority,
      outcome === "success"
        ? {
            kind: "succeeded",
            authority: row.authority,
            amountToman: row.amountToman,
            currency: "TOMAN",
            reference: "fake-ref-" + id,
          }
        : outcome === "failed"
          ? { kind: "failed", authority: row.authority }
          : { kind: outcome },
    );
  }
  const view = await (await configuredPaymentFramework()).inquire(id, randomUUID());
  // Never print redirect/callback URLs, credentials, or the entire persistence document.
  console.log(JSON.stringify({ id: view.id, status: view.status, issue: view.issue }));
} catch {
  console.error("Payment command failed; inspect correlated audit events and configuration.");
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
