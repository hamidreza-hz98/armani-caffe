import "server-only";

import net from "node:net";
import tls from "node:tls";

import { HeadBucketCommand } from "@aws-sdk/client-s3";

import { getDatabaseConnection } from "../database/connection.ts";
import { configuredMinioClient } from "../minio/index.ts";
import { createPrintRedis } from "../queue/index.ts";
import { getServerConfig } from "../secrets/config.ts";

const timeoutMs = 2500;

function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function probeMongo(): Promise<void> {
  const connection = await bounded(getDatabaseConnection(), "MongoDB connection");
  await bounded(
    connection
      .db!.admin()
      .command({ ping: 1, maxTimeMS: 2000 })
      .then(() => undefined),
    "MongoDB ping",
  );
}

function command(...parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
}

export function probeRedis(): Promise<void> {
  const url = new URL(getServerConfig().redisUrl);
  const port = Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379));
  return new Promise((resolve, reject) => {
    const socket =
      url.protocol === "rediss:"
        ? tls.connect({ host: url.hostname, port, servername: url.hostname })
        : net.connect({ host: url.hostname, port });
    let settled = false;
    let buffer = "";
    const expected = url.password ? 2 : 1;
    let replies = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error("Redis timed out")));
    socket.on("error", finish);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n");
        const reply = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (reply.startsWith("-"))
          return finish(new Error(`Redis rejected readiness probe: ${reply}`));
        if (!reply.startsWith("+")) return finish(new Error("Unexpected Redis response"));
        replies += 1;
        if (replies === expected)
          return finish(reply === "+PONG" ? undefined : new Error("Redis did not PONG"));
      }
    });
    socket.on(url.protocol === "rediss:" ? "secureConnect" : "connect", () => {
      if (url.password) {
        socket.write(
          command(
            ...(url.username
              ? ["AUTH", decodeURIComponent(url.username), decodeURIComponent(url.password)]
              : ["AUTH", decodeURIComponent(url.password)]),
          ),
        );
      }
      socket.write(command("PING"));
    });
  });
}

export async function probeMinio(): Promise<void> {
  const endpoint = new URL(getServerConfig().minio.endpoint);
  const url = new URL("/minio/health/ready", endpoint);
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!response.ok) throw new Error(`MinIO readiness returned ${response.status}`);
  const client = configuredMinioClient();
  try {
    await client.send(new HeadBucketCommand({ Bucket: getServerConfig().minio.bucket }), {
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
  } finally {
    client.destroy();
  }
}

export async function probePrintQueue(): Promise<void> {
  const config = getServerConfig();
  const prefix =
    config.mode === "test" ? (process.env.TEST_REDIS_PREFIX ?? "armani-test") : "armani";
  const queue = await bounded(
    createPrintRedis(config.redisUrl, prefix, 2000),
    "Print queue connection",
  );
  try {
    await bounded(queue.ping(), "Print queue ping");
  } finally {
    await queue.close();
  }
}
export async function probeRealtime(): Promise<void> {
  const config = getServerConfig();
  const response = await fetch(`http://127.0.0.1:${config.webSocket.port}/ready`, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Realtime service not ready");
}
export const dependencyProbes = {
  mongodb: probeMongo,
  redis: probeRedis,
  minio: probeMinio,
  queue: probePrintQueue,
  realtime: probeRealtime,
};
