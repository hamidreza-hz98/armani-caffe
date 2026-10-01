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

test("invalid browser callback gets generic result without payment details", async ({
  request,
}) => {
  const response = await request.get(
    "/api/payments/callback/fake/000000000000000000000001?result=success",
    {
      headers: { accept: "text/html" },
      maxRedirects: 0,
    },
  );
  expect(response.status()).toBe(303);
  expect(response.headers().location).toMatch(/\/payment\/result$/u);
  expect(new URL(response.headers().location).origin).toBe("http://localhost:3000");
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("guest payment and order URLs disclose no customer or transaction details", async ({
  page,
}) => {
  const id = "000000000000000000000001";
  await page.goto(`/payment/result/${id}`);
  await expect(page.getByRole("heading", { name: "برای مشاهده نتیجه وارد شوید" })).toBeVisible();
  await expect(page.getByText("شماره پیگیری تراکنش")).toHaveCount(0);
  await page.goto(`/orders/${id}`);
  await expect(page.getByRole("heading", { name: "برای مشاهده سفارش وارد شوید" })).toBeVisible();
});
