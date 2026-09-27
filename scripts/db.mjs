import { randomUUID } from "node:crypto";

const command = process.argv[2];
const apply = process.argv.includes("--apply");
const mutating = new Set(["migrate:up", "indexes:apply", "seed", "smoke"]);
const known = new Set(["migrate:status", "indexes:plan", ...mutating]);

if (!known.has(command)) {
  throw new Error("Use migrate:status, migrate:up, indexes:plan, indexes:apply, seed, or smoke");
}
if (mutating.has(command) && !apply) {
  throw new Error(`${command} changes the database; pass --apply explicitly`);
}

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
process.env.NODE_ENV ??= "development";

const { applyDatabaseIndexes, applyMigrations, databaseIndexes, migrationStatus, seedBaseline } =
  await import("../src/server/database/operations.ts");

if (command === "indexes:plan") {
  console.log(JSON.stringify(databaseIndexes, null, 2));
} else {
  if (["seed", "smoke"].includes(command) && process.env.NODE_ENV === "production") {
    throw new Error(`${command} is disabled in production`);
  }
  if (["seed", "smoke"].includes(command)) {
    let host;
    try {
      host = new URL(process.env.MONGODB_URI ?? "").hostname;
    } catch {
      throw new Error(`${command} requires a valid loopback MongoDB URI`);
    }
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
      throw new Error(`${command} requires a loopback MongoDB host`);
    }
  }
  const { getDatabaseConnection } = await import("../src/server/database/connection.ts");
  const connection = await getDatabaseConnection();
  try {
    if (command === "migrate:status") {
      console.log(JSON.stringify(await migrationStatus(connection), null, 2));
    } else if (command === "migrate:up") {
      console.log(
        `Applied migrations: ${(await applyMigrations(connection)).join(", ") || "none"}`,
      );
    } else if (command === "indexes:apply") {
      await applyDatabaseIndexes(connection);
      console.log("Declared indexes created or confirmed; no indexes were dropped.");
    } else if (command === "seed") {
      await seedBaseline(connection);
      console.log("Deterministic baseline seed confirmed.");
    } else if (command === "smoke") {
      const id = randomUUID();
      const collection = connection.db.collection("_db_smoke");
      try {
        await connection.transaction(async (session) => {
          await collection.insertOne({ _id: id, passed: true }, { session });
        });
        if (!(await collection.findOne({ _id: id }))?.passed) {
          throw new Error("Committed transaction was not visible");
        }
        console.log("MongoDB connection and transaction smoke test passed.");
      } finally {
        await collection.deleteOne({ _id: id });
      }
    }
  } finally {
    await connection.close();
  }
}
