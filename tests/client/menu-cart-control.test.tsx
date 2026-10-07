import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { CartControl } from "../../src/storefront/cart-control.tsx";
import { MenuCartProvider } from "../../src/storefront/menu-cart.tsx";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const id = "b".repeat(24);
const cartId = "a".repeat(24);
const cart = (items: unknown[] = [], revision = 3) => ({
  id: cartId,
  revision,
  items,
  notes: "",
  expiresAt: "2030-01-01T00:00:00Z",
  pricing: { subtotalToman: 0, discountToman: 0, deliveryToman: 0, totalToman: 0 },
  issues: [],
  checkoutReady: true,
  accepted: true,
});
const success = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, value }),
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

test("options sheet prices additions without a quote request or client price in cart mutation", async () => {
  const fetcher = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/customer/cart" && !init?.body) return Promise.resolve(success(cart()));
    if (url.endsWith("/options") && !init?.body)
      return Promise.resolve(
        success({
          id,
          name: "آمریکانو",
          description: "",
          basePriceToman: 100000,
          imageId: null,
          orderable: true,
          additions: [
            {
              id: "c".repeat(24),
              name: "شات اضافه",
              priceToman: 30000,
              available: true,
              imageId: null,
            },
          ],
        }),
      );
    if (url.endsWith("/options")) throw new Error("Quote endpoint must not be called");
    return Promise.resolve(
      success(
        cart(
          [
            {
              productId: id,
              productName: "آمریکانو",
              additions: [],
              quantity: 1,
              note: "کم‌شیرین",
              unitPriceToman: 130000,
              lineTotalToman: 130000,
            },
          ],
          4,
        ),
      ),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <MenuCartProvider>
      <CartControl productId={id} orderable hasAdditions />
    </MenuCartProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "افزودن" }));
  await screen.findByText("شات اضافه");
  fireEvent.click(screen.getByRole("checkbox", { name: /شات اضافه/ }));
  fireEvent.change(screen.getByLabelText("توضیحات برای باریستا (اختیاری)"), {
    target: { value: "کم‌شیرین" },
  });
  await screen.findByText("۱۳۰٬۰۰۰ تومان");
  fireEvent.click(screen.getByRole("button", { name: "افزودن به سبد" }));
  await screen.findByText("به سبد خرید شما افزوده شد!");
  const mutation = fetcher.mock.calls.find(
    ([url, init]) => url === "/api/customer/cart" && init?.body,
  );
  expect(JSON.parse(mutation![1].body)).toEqual({
    operation: "add",
    cartId,
    revision: 3,
    productId: id,
    additionIds: ["c".repeat(24)],
    quantity: 1,
    note: "کم‌شیرین",
  });
  expect(
    fetcher.mock.calls.filter(([url, init]) => url.endsWith("/options") && init?.body),
  ).toHaveLength(0);
  expect(refresh).toHaveBeenCalledOnce();
});

test("guest can view a quote; unavailable product offers no add control", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) =>
      url.includes("/options") && init?.body
        ? Promise.resolve(
            success({
              productId: id,
              additionIds: [],
              quantity: 1,
              unitPriceToman: 100000,
              totalToman: 100000,
            }),
          )
        : url.includes("/options")
          ? Promise.resolve(
              success({
                id,
                name: "آمریکانو",
                description: "",
                basePriceToman: 100000,
                imageId: null,
                orderable: true,
                additions: [],
              }),
            )
          : Promise.resolve({
              ok: false,
              status: 401,
              json: async () => ({ ok: false, error: { code: "UNAUTHORIZED", message: "Login" } }),
            }),
    ),
  );
  const view = render(
    <MenuCartProvider>
      <CartControl productId={id} orderable />
    </MenuCartProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "افزودن" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "افزودن به سبد" })).toBeVisible());
  view.rerender(
    <MenuCartProvider>
      <CartControl productId={id} orderable={false} />
    </MenuCartProvider>,
  );
  expect(screen.getByLabelText("این محصول ناموجود است")).toBeVisible();
});
