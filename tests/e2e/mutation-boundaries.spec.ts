import { expect, test } from "@playwright/test";

const id = "0123456789abcdef01234567";
const guardedMutations = [
  ["POST", "/api/admins"],
  ["PATCH", `/api/admins/${id}`],
  ["DELETE", `/api/admins/${id}`],
  ["POST", `/api/admins/${id}/password`],
  ["POST", "/api/categories"],
  ["PATCH", `/api/categories/${id}`],
  ["DELETE", `/api/categories/${id}`],
  ["POST", "/api/categories/reorder"],
  ["POST", "/api/products"],
  ["PATCH", `/api/products/${id}`],
  ["POST", `/api/products/${id}/publish`],
  ["POST", `/api/products/${id}/unpublish`],
  ["POST", `/api/products/${id}/archive`],
  ["POST", "/api/inventory"],
  ["PATCH", `/api/inventory/${id}`],
  ["POST", "/api/inventory/requests"],
  ["POST", `/api/inventory/requests/${id}/decision`],
  ["POST", "/api/media"],
  ["POST", "/api/media/bulk"],
  ["POST", `/api/media/${id}/complete`],
  ["POST", "/api/media/bulk/complete"],
  ["PATCH", `/api/media/${id}`],
  ["DELETE", `/api/media/${id}`],
  ["POST", `/api/media/${id}/replace`],
  ["PATCH", "/api/settings/printing"],
  ["POST", `/api/admin/orders/${id}/status`],
  ["POST", `/api/admin/orders/${id}/refund`],
  ["POST", `/api/admin/orders/${id}/invoice/reprint`],
  ["POST", `/api/admin/orders/recovery/${id}/retry`],
  ["POST", `/api/admin/orders/recovery/${id}/refund`],
  ["PATCH", "/api/customer/profile"],
  ["POST", "/api/customer/cart"],
  ["POST", "/api/customer/cart/preview"],
  ["POST", "/api/checkout"],
] as const;

test("all browser mutation surfaces reject an anonymous forged-role caller with safe errors", async ({
  request,
}) => {
  for (const [method, path] of guardedMutations) {
    const response = await request.fetch(path, {
      method,
      headers: {
        Origin: "http://127.0.0.1:3107",
        "Content-Type": "application/json",
        "x-admin-role": "OWNER",
        "x-customer-id": id,
      },
      data: {},
    });
    expect([401, 403], `${method} ${path}`).toContain(response.status());
    expect(response.headers()["x-request-id"], `${method} ${path}`).toBeTruthy();
    const body = await response.json();
    expect(body, `${method} ${path}`).toMatchObject({
      ok: false,
      error: { requestId: expect.any(String) },
    });
  }
});
