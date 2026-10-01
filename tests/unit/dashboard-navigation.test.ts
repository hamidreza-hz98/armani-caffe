import { expect, test } from "vitest";

import { dashboardSection, linksForRole, safeDashboardDestination } from "@/dashboard/navigation";

test("cashier navigation omits owner-only administration", () => {
  const owner = linksForRole("OWNER").map((link) => link.href);
  const cashier = linksForRole("CASHIER").map((link) => link.href);
  expect(owner).toContain("/dashboard/admins");
  expect(cashier).not.toContain("/dashboard/admins");
  expect(cashier).toContain("/dashboard/orders");
  expect(cashier.every((href) => owner.includes(href))).toBe(true);
  expect(dashboardSection("admins")?.capability).toBe("admins.read");
  expect(dashboardSection("unknown")).toBeNull();
});

test("login return paths cannot escape the dashboard or smuggle a URL", () => {
  expect(safeDashboardDestination("/dashboard/orders")).toBe("/dashboard/orders");
  for (const path of [
    "//evil.example",
    "https://evil.example",
    "/dashboard/login",
    "/dashboard/orders?next=//evil",
    "/dashboard/../admin",
    "\\evil",
    null,
  ])
    expect(safeDashboardDestination(path)).toBe("/dashboard");
});
