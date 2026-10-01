import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

import { testEnv } from "../tests/fixtures/config.mjs";
import { isolatedResources } from "../tests/fixtures/isolation.ts";

const resources = isolatedResources("e2e");
const withProductFixtures = process.argv.includes("--with-product-fixtures");
const withAdminDb = process.argv.includes("--with-admin-db") || withProductFixtures;
const testArgs = process.argv
  .slice(2)
  .filter((arg) => !["--with-admin-db", "--with-product-fixtures"].includes(arg));
let replica;
if (withAdminDb) {
  const installed = "C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe";
  const systemBinary =
    process.env.MONGOMS_SYSTEM_BINARY ??
    (process.platform === "win32" && existsSync(installed) ? installed : undefined);
  const version = systemBinary
    ? /db version v(\d+\.\d+\.\d+)/.exec(
        execFileSync(systemBinary, ["--version"], { encoding: "utf8" }),
      )?.[1]
    : undefined;
  replica = await MongoMemoryReplSet.create({
    binary: systemBinary ? { systemBinary, ...(version ? { version } : {}) } : undefined,
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
}
const env = {
  ...process.env,
  ...testEnv({
    MONGODB_URI: replica
      ? replica.getUri(resources.databaseName)
      : `mongodb://127.0.0.1:1/${resources.databaseName}?directConnection=true`,
    REDIS_URL: "redis://127.0.0.1:1",
    MINIO_ENDPOINT: "http://127.0.0.1:1",
    MINIO_BUCKET: resources.minioBucket,
  }),
  TEST_REDIS_PREFIX: resources.redisPrefix,
};
env.NODE_ENV = "production";
delete env.ENCRYPTION_KEY_PREVIOUS;
delete env.TEST_FIXED_TIME;
delete env.TEST_RANDOM_SEED;
delete env.NO_COLOR;

const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
env.E2E_PORT = String(listener.address().port);
await new Promise((resolve) => listener.close(resolve));
if (withAdminDb) {
  const url = `http://127.0.0.1:${env.E2E_PORT}`;
  env.APP_URL = url;
  env.ADMIN_URL = url;
  env.NEXT_PUBLIC_APP_URL = url;
  env.PAYMENT_CALLBACK_BASE_URL = url;
  env.E2E_ADMIN_DB = "1";
  if (withProductFixtures) env.E2E_PRODUCT_FIXTURES = "1";
}

async function run(args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env,
      stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`E2E setup/test process failed (${code})`)),
    );
    if (input) child.stdin.end(input);
  });
}

try {
  if (withAdminDb) {
    await run(["--conditions=react-server", "scripts/db.mjs", "migrate:up", "--apply"]);
    await run(["--conditions=react-server", "scripts/db.mjs", "indexes:apply", "--apply"]);
    await run(
      ["--conditions=react-server", "scripts/admin-bootstrap.mjs", "--apply"],
      JSON.stringify({
        username: "e2e-owner",
        displayName: "مدیر آزمایشی",
        phone: "09123456789",
        password: "dashboard-e2e-password-12345",
        role: "OWNER",
      }),
    );
    if (withProductFixtures) {
      const connection = await mongoose.createConnection(env.MONGODB_URI).asPromise();
      try {
        const owner = await connection.db.collection("admins").findOne({ username: "e2e-owner" });
        if (!owner) throw new Error("E2E owner fixture is missing");
        const imageId = new mongoose.Types.ObjectId();
        await connection.db.collection("media_assets").insertOne({
          _id: imageId,
          objectKey: `e2e-image-${imageId}`,
          bucket: resources.minioBucket,
          mimeType: "image/webp",
          byteSize: 100,
          sha256: "a".repeat(64),
          filename: "sample.webp",
          objectVersion: String(imageId),
          title: "تصویر آزمایشی محصول",
          altText: "فنجان قهوه",
          caption: "",
          seo: { title: "", description: "", keywords: [] },
          visibility: "public",
          width: 100,
          height: 100,
          variants: [],
          uploaderId: owner._id,
          ownerId: owner._id,
          initiationKey: String(imageId),
          fingerprint: "b".repeat(64),
          ticketCiphertext: "test-only",
          stagingKey: "test-only",
          expiresAt: new Date("2030-01-01"),
          referenceGuard: 0,
          status: "ready",
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          __v: 0,
        });
      } finally {
        await connection.close();
      }
    }
  }
  await run([path.join("node_modules", "next", "dist", "bin", "next"), "build"]);
  await run([path.join("node_modules", "@playwright", "test", "cli.js"), "test", ...testArgs]);
} finally {
  await replica?.stop();
}
