import { expect, test } from "vitest";
import { WebSocket } from "ws";

import type { MongoPrintJobs } from "@/modules/printing/server";
import type { PrintSchedule } from "@/server/queue";
import { startPrintRealtime } from "@/server/realtime";

test("one bridge socket cannot race two registrations while authorization is pending", async () => {
  const acquired: string[] = [];
  const released: string[] = [];
  const schedule = {
    ping: async () => undefined,
    acquirePresence: async (printerId: string) => {
      acquired.push(printerId);
      return true;
    },
    releasePresence: async (printerId: string) => {
      released.push(printerId);
      return true;
    },
  } as unknown as PrintSchedule;
  const server = await startPrintRealtime({
    port: 0,
    path: "/ws",
    heartbeatMs: 1000,
    origins: [],
    authorizeBridge: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return true;
    },
    schedule,
    jobs: {} as MongoPrintJobs,
    authenticateAdmin: async () => false,
    payload: async () => ({}),
  });
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=bridge`);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const messages: Record<string, unknown>[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    for (const printerId of ["printer_one", "printer_two"])
      socket.send(
        JSON.stringify({
          v: 1,
          type: "register",
          printerId,
          token: "a".repeat(32),
          instanceId: "instance-one",
        }),
      );
    await closed;
    expect(messages.filter((message) => message.type === "registered")).toHaveLength(1);
    expect(acquired).toEqual(["printer_one"]);
    expect(released).toEqual(["printer_one"]);
    expect(server.available("printer_two")).toBe(false);
  } finally {
    socket.terminate();
    await server.close();
  }
});

test("a bridge cannot grow an unbounded pending-message queue", async () => {
  const server = await startPrintRealtime({
    port: 0,
    path: "/ws",
    heartbeatMs: 1000,
    origins: [],
    authorizeBridge: async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return true;
    },
    schedule: {
      acquirePresence: async () => true,
      releasePresence: async () => true,
    } as unknown as PrintSchedule,
    jobs: {} as MongoPrintJobs,
    authenticateAdmin: async () => false,
    payload: async () => ({}),
  });
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=bridge`);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    const message = JSON.stringify({
      v: 1,
      type: "register",
      printerId: "printer_one",
      token: "a".repeat(32),
      instanceId: "instance-one",
    });
    for (let index = 0; index < 34; index++) socket.send(message);
    expect(await closed).toBe(1008);
    expect(server.available("printer_one")).toBe(false);
  } finally {
    socket.terminate();
    await server.close();
  }
});
