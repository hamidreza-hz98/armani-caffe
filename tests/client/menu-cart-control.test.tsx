import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { CartControl } from "../../src/storefront/cart-control.tsx";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

test("add-to-cart sends only selection and current version, never a client price", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: { id: "a".repeat(24), revision: 3 } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: {} }),
    });
  vi.stubGlobal("fetch", fetcher);
  render(<CartControl productId={"b".repeat(24)} orderable />);
  fireEvent.click(screen.getByRole("button", { name: "+ افزودن" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "افزوده شد" })).toBeVisible());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).toBe("/api/customer/cart");
  expect(fetcher.mock.calls[1][1].method).toBe("POST");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    operation: "add",
    cartId: "a".repeat(24),
    revision: 3,
    productId: "b".repeat(24),
    additionIds: [],
    quantity: 1,
  });
  expect(refresh).toHaveBeenCalledOnce();
});

test("guest receives a login prompt and unavailable product cannot be added", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401 });
  vi.stubGlobal("fetch", fetcher);
  const view = render(<CartControl productId={"b".repeat(24)} orderable />);
  fireEvent.click(screen.getByRole("button", { name: "+ افزودن" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "وارد شوید" })).toBeVisible());
  expect(fetcher).toHaveBeenCalledOnce();
  view.rerender(<CartControl productId={"b".repeat(24)} orderable={false} />);
  expect(screen.queryByRole("button", { name: "+ افزودن" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("این محصول ناموجود است")).toBeVisible();
});
