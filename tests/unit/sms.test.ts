import { expect, test, vi } from "vitest";

import { createOtpHttpHandler, SmsIrSender } from "@/modules/sms/server";

import { testEnv } from "../fixtures/config.mjs";

test("SMS.ir sender uses the verification template endpoint and rejects provider failures", async () => {
  const fetcher = vi.fn(async () => Response.json({ status: 1 }));
  const sender = new SmsIrSender("private-api-key", fetcher as typeof fetch);
  await sender.sendTemplate({
    mobile: "09123456789",
    templateId: 123,
    parameters: [{ name: "CODE", value: "123456" }],
  });
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.sms.ir/v1/send/verify",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-API-KEY": "private-api-key" }),
      body: JSON.stringify({
        mobile: "09123456789",
        templateId: 123,
        parameters: [{ name: "CODE", value: "123456" }],
      }),
    }),
  );
  const rejected = new SmsIrSender("key", (async () =>
    Response.json({ status: 0 })) as typeof fetch);
  await expect(
    rejected.sendTemplate({ mobile: "09123456789", templateId: 123, parameters: [] }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

test("OTP preview accepts arbitrary entry without sending or authenticating", async () => {
  Object.assign(process.env, testEnv());
  const send = vi.fn();
  const handler = createOtpHttpHandler({
    origin: () => "https://cafe.example",
    preview: () => true,
    send,
  });
  const request = (origin: string) =>
    new Request("https://cafe.example/api/customer/auth/otp", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "anything", purpose: "signup" }),
    });
  const response = await handler(request("https://cafe.example"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, value: { preview: true } });
  expect(send).not.toHaveBeenCalled();
  expect((await handler(request("https://evil.example"))).status).toBe(403);
});
