import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { MenuFailure, MenuSkeleton, MenuView } from "../../src/storefront/menu-view.tsx";

test("empty catalog has a useful Persian state", () => {
  render(<MenuView categories={[]} />);
  expect(screen.getByRole("heading", { name: "منو فعلاً خالی است" })).toBeVisible();
});

test("loading and failure states communicate clearly", () => {
  const loading = render(<MenuSkeleton />);
  expect(screen.getByLabelText("در حال بارگذاری منو")).toHaveAttribute("aria-busy", "true");
  loading.unmount();
  render(<MenuFailure />);
  expect(screen.getByRole("alert")).toHaveTextContent("دریافت منو ممکن نشد");
  expect(screen.getByRole("link", { name: "تلاش دوباره" })).toHaveAttribute("href", "/");
});
