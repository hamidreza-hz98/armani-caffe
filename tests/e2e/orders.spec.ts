import { expect, test } from "@playwright/test";
test("orders, checkout and recovery reject forged identity without downstream connections", async ({
  request,
}) => {
  for (const path of [
    "/api/customer/orders",
    "/api/admin/orders",
    "/api/admin/orders/recovery",
    "/api/admin/orders/000000000000000000000001/print",
    "/api/checkout/000000000000000000000001",
  ]) {
    const response = await request.get(path, {
      headers: { "X-Customer-ID": "000000000000000000000001", "X-Admin-Role": "OWNER" },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect((await response.json()).error.message).toBe("برای ادامه وارد حساب خود شوید.");
  }
  for (const path of [
    "/api/checkout",
    "/api/admin/orders/000000000000000000000001/status",
    "/api/admin/orders/000000000000000000000001/refund",
    "/api/admin/orders/recovery/000000000000000000000001/retry",
  ]) {
    expect(
      (
        await request.post(path, {
          headers: { Origin: "https://evil.example" },
          data: { status: "COMPLETED", totalToman: 1 },
        })
      ).status(),
    ).toBe(403);
  }
});
