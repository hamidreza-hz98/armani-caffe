import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("production server serves the Persian RTL home page", async () => {
  const port = await unusedPort();
  const child = spawn(
    process.execPath,
    [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  const url = `http://127.0.0.1:${port}`;

  try {
    let response;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (child.exitCode !== null) throw new Error("Production server exited before it was ready");
      try {
        response = await fetch(url);
        break;
      } catch {
        await delay(500);
      }
    }

    assert.ok(response, "Production server did not become ready");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<html lang="fa" dir="rtl">/);
    assert.match(html, /<h1>آرمانی کافه<\/h1>/);
  } finally {
    child.kill();
  }
});

test("production server exits when a required secret is missing", async () => {
  const port = await unusedPort();
  const result = spawnSync(
    process.execPath,
    [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
    {
      cwd: process.cwd(),
      env: { ...process.env, AUTH_SESSION_SECRET: "" },
      encoding: "utf8",
      timeout: 20000,
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /AUTH_SESSION_SECRET is required/);
});
