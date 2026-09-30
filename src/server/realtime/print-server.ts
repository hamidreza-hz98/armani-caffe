import "server-only";

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { WebSocket, WebSocketServer } from "ws";

import { parseBridgeMessage } from "../../modules/printing/index.ts";
import { MongoPrintJobs, type PrintJobView } from "../../modules/printing/server.ts";
import type { PrintSchedule } from "../queue/index.ts";

type Bridge = {
  socket: WebSocket;
  nonce: string;
  instanceId: string;
  lastSeen: number;
  pong: boolean;
};
export type RealtimeOptions = {
  port: number;
  path: string;
  heartbeatMs: number;
  origins: readonly string[];
  authorizeBridge: (printerId: string, token: string) => Promise<boolean>;
  schedule: PrintSchedule;
  jobs: MongoPrintJobs;
  authenticateAdmin: (cookie: string | undefined) => Promise<boolean>;
  payload: (job: PrintJobView) => Promise<object>;
  now?: () => Date;
};
export async function startPrintRealtime(options: RealtimeOptions) {
  const now = options.now ?? (() => new Date());
  const bridges = new Map<string, Bridge>(),
    admins = new Set<WebSocket>(),
    adminCookies = new Map<WebSocket, string | undefined>();
  const presenceTtl = options.heartbeatMs * 3;
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/live") {
      response.writeHead(200);
      response.end(JSON.stringify({ status: "alive" }));
      return;
    }
    if (request.url === "/ready") {
      try {
        await Promise.race([
          options.schedule.ping(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("queue timeout")), 2000),
          ),
        ]);
        response.writeHead(200);
        response.end(JSON.stringify({ status: "ready" }));
      } catch {
        response.writeHead(503);
        response.end(JSON.stringify({ status: "not_ready" }));
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  function send(socket: WebSocket, value: object): boolean {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1_000_000) return false;
    socket.send(JSON.stringify({ v: 1, ...value }));
    return true;
  }
  function announce(job: PrintJobView) {
    for (const socket of admins) send(socket, { type: "print.status", job });
  }
  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      const url = new URL(request.url ?? "", "http://localhost");
      const role = url.searchParams.get("role");
      const origin = request.headers.origin;
      if (
        url.pathname !== options.path ||
        url.searchParams.size !== 1 ||
        !["admin", "bridge"].includes(role ?? "") ||
        (origin && !options.origins.includes(origin)) ||
        (role === "admin" && !origin)
      ) {
        socket.destroy();
        return;
      }
      if (role === "admin" && !(await options.authenticateAdmin(request.headers.cookie))) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        if (role === "admin") {
          admins.add(ws);
          adminCookies.set(ws, request.headers.cookie);
          send(ws, { type: "admin.ready", room: "tenant:default:print" });
          ws.on("message", () => ws.close(1008, "Read-only room"));
          ws.on("close", () => {
            admins.delete(ws);
            adminCookies.delete(ws);
          });
          return;
        }
        let registered: { printerId: string; nonce: string } | null = null;
        const registrationTimer = setTimeout(() => ws.close(1008, "Registration timeout"), 5000);
        ws.on("message", (bytes) => {
          void (async () => {
            const message = parseBridgeMessage(bytes.toString());
            if (!registered) {
              if (
                message.type !== "register" ||
                !(await options.authorizeBridge(message.printerId, message.token))
              )
                throw new Error("Bridge registration rejected");
              const nonce = randomUUID();
              if (
                bridges.has(message.printerId) ||
                !(await options.schedule.acquirePresence(message.printerId, nonce, presenceTtl))
              )
                throw new Error("Printer already connected");
              registered = { printerId: message.printerId, nonce };
              bridges.set(message.printerId, {
                socket: ws,
                nonce,
                instanceId: message.instanceId,
                lastSeen: now().getTime(),
                pong: true,
              });
              clearTimeout(registrationTimer);
              send(ws, {
                type: "registered",
                printerId: message.printerId,
                heartbeatMs: options.heartbeatMs,
              });
              return;
            }
            if (message.type === "heartbeat") {
              if (Math.abs(now().getTime() - Date.parse(message.at)) > presenceTtl)
                throw new Error("Stale heartbeat");
              if (
                !(await options.schedule.refreshPresence(
                  registered.printerId,
                  registered.nonce,
                  presenceTtl,
                ))
              )
                throw new Error("Presence lease lost");
              const current = bridges.get(registered.printerId);
              if (current?.socket === ws) current.lastSeen = now().getTime();
              send(ws, { type: "heartbeat.ack", at: now().toISOString() });
              return;
            }
            if (message.type === "ack" && message.printerId === registered.printerId) {
              const job = await options.jobs.acknowledge(message);
              if (job.status === "queued" && job.nextAttemptAt)
                await options.schedule.schedule(job.id, new Date(job.nextAttemptAt));
              send(ws, {
                type: "ack.accepted",
                jobId: job.id,
                status: job.status,
                attempt: job.attempts,
              });
              announce(job);
              return;
            }
            throw new Error("Message not allowed for bridge");
          })().catch(() => ws.close(1008, "Protocol error"));
        });
        ws.on("pong", () => {
          if (registered) {
            const current = bridges.get(registered.printerId);
            if (current?.socket === ws) current.pong = true;
          }
        });
        ws.on("close", () => {
          clearTimeout(registrationTimer);
          if (registered) {
            const current = bridges.get(registered.printerId);
            if (current?.socket === ws) bridges.delete(registered.printerId);
            void options.schedule
              .releasePresence(registered.printerId, registered.nonce)
              .catch(() => undefined);
          }
        });
      });
    })().catch(() => socket.destroy());
  });
  const heartbeat = setInterval(() => {
    for (const [socket, cookie] of adminCookies) {
      void options
        .authenticateAdmin(cookie)
        .then((allowed) => {
          if (!allowed) socket.terminate();
        })
        .catch(() => socket.terminate());
    }
    for (const [printerId, bridge] of bridges) {
      if (!bridge.pong || now().getTime() - bridge.lastSeen > presenceTtl) {
        bridge.socket.terminate();
        bridges.delete(printerId);
        continue;
      }
      bridge.pong = false;
      bridge.socket.ping();
    }
  }, options.heartbeatMs);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    available: (printerId: string) => bridges.get(printerId)?.socket.readyState === WebSocket.OPEN,
    async deliver(job: PrintJobView): Promise<boolean> {
      const bridge = bridges.get(job.printerId);
      if (!bridge) return false;
      const payload = await options.payload(job);
      const sent = send(bridge.socket, { type: "print.job", ...payload });
      if (sent) announce(job);
      return sent;
    },
    async close() {
      clearInterval(heartbeat);
      for (const bridge of bridges.values()) bridge.socket.terminate();
      for (const admin of admins) admin.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
