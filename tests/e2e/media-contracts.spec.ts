import { expect, test } from "../fixtures/playwright.ts";

test("media mutation routes fail closed and ignore forged actor headers", async ({ request }) => {
  const response = await request.post("/api/media", {
    headers: {
      Origin: "http://localhost:3000",
      "Idempotency-Key": "forged-owner-test",
      "X-Admin-Role": "OWNER",
      "X-Admin-ID": "000000000000000000000001",
    },
    data: { filename: "a.jpg", mimeType: "image/jpeg", byteSize: 100, metadata: {} },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: { code: "UNAUTHORIZED", message: "برای ادامه وارد حساب خود شوید." },
  });
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
});

test("media query and ID validation do not require downstream connections", async ({ request }) => {
  const list = await request.get("/api/media?sort=objectKey");
  expect(list.status()).toBe(400);
  const detail = await request.get("/api/media/not-an-id");
  expect(detail.status()).toBe(400);
  const file = await request.get("/api/media/000000000000000000000001/file?variant=unsupported");
  expect(file.status()).toBe(400);
});
