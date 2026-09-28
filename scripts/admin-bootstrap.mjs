import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { parseAdminCreate } from "../src/modules/admins/server.ts";
import { createAdminSecurity } from "../src/modules/auth/server.ts";
import {
  closeDatabaseConnection,
  getDatabaseConnection,
} from "../src/server/database/connection.ts";
import { getServerConfig } from "../src/server/secrets/config.ts";

try {
  if (process.argv.slice(2).join(" ") !== "--apply")
    throw new Error("Explicit --apply and private JSON on stdin are required");
  if (process.stdin.isTTY)
    throw new Error(
      "Supply private bootstrap JSON on stdin; passwords are never accepted in arguments",
    );
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 8192) throw new Error("Bootstrap input exceeds limit");
    chunks.push(chunk);
  }
  const input = parseAdminCreate(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (input.role !== "OWNER") throw new Error("Bootstrap requires OWNER");
  const config = getServerConfig(),
    security = createAdminSecurity(await getDatabaseConnection(), config.auth.adminSessionSecret);
  const owner = await security.repository.bootstrap(
    input,
    await security.passwords.hash(input.password),
    randomUUID(),
  );
  console.log(`Owner bootstrap committed: ${owner.id}. No credential was logged.`);
} catch {
  console.error(
    "Owner bootstrap failed. Require --apply, valid private JSON, configured database/indexes, and an empty admin collection. No credential was logged.",
  );
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
