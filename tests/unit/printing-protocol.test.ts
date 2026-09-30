import { expect, test } from "vitest";

import { parseBridgeMessage, printProtocolVersion } from "@/modules/printing";

test("print protocol v1 accepts exact registration, heartbeat and ACK contracts", () => {
  expect(printProtocolVersion).toBe(1);
  expect(
    parseBridgeMessage(
      JSON.stringify({
        v: 1,
        type: "register",
        printerId: "printer_1",
        token: "a".repeat(32),
        instanceId: "instance-001",
      }),
    ),
  ).toMatchObject({ type: "register", printerId: "printer_1" });
  expect(
    parseBridgeMessage(JSON.stringify({ v: 1, type: "heartbeat", at: "2026-01-01T00:00:00.000Z" })),
  ).toMatchObject({ type: "heartbeat" });
  expect(
    parseBridgeMessage(
      JSON.stringify({
        v: 1,
        type: "ack",
        jobId: "0".repeat(24),
        printerId: "printer_1",
        attempt: 2,
        deliveryId: "00000000-0000-0000-0000-000000000000",
        result: "error",
        errorCode: "PAPER_OUT",
        at: "2026-01-01T00:00:00.000Z",
      }),
    ),
  ).toMatchObject({ type: "ack", result: "error" });
});
test("print protocol rejects unknown versions, fields, identities and oversized input", () => {
  for (const value of [
    { v: 2, type: "heartbeat", at: "2026-01-01T00:00:00.000Z" },
    {
      v: 1,
      type: "register",
      printerId: "../bad",
      token: "a".repeat(32),
      instanceId: "instance-001",
    },
    { v: 1, type: "heartbeat", at: "2026-01-01T00:00:00.000Z", tenant: "other" },
    {
      v: 1,
      type: "ack",
      jobId: "0".repeat(24),
      printerId: "printer_1",
      attempt: 0,
      deliveryId: "00000000-0000-0000-0000-000000000000",
      result: "printed",
      at: "2026-01-01T00:00:00.000Z",
    },
  ])
    expect(() => parseBridgeMessage(JSON.stringify(value))).toThrow();
  expect(() => parseBridgeMessage("x".repeat(8193))).toThrow();
});
