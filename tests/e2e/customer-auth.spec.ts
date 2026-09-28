import { expect, test } from "@playwright/test";

test("customer API refuses forged identity, invalid origin, and missing session", async ({
  request,
}) => {
  const profile = await request.get("/api/customer/profile", {
    headers: { "X-Customer-ID": "000000000000000000000001", "X-Customer-Role": "customer" },
  });
  expect(profile.status()).toBe(401);
  const signup = await request.post("/api/customer/auth/signup", {
    data: { phone: "09123456789", password: "safe-password-12345" },
    headers: { Origin: "https://evil.example" },
  });
  expect(signup.status()).toBe(403);
  const session = await request.get("/api/customer/auth/session");
  expect(session.status()).toBe(401);
});
