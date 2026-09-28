import { expect, test } from "@playwright/test";
test("unknown gateways and malformed callback IDs cannot reach verification", async ({
  request,
}) => {
  const id = "000000000000000000000001";
  const unknown = await request.get(`/api/payments/callback/unregistered/${id}?result=success`);
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()["cache-control"]).toBe("no-store");
  expect(unknown.headers()["referrer-policy"]).toBe("no-referrer");
  expect((await request.get("/api/payments/callback/fake/not-an-id?result=success")).status()).toBe(
    400,
  );
});
