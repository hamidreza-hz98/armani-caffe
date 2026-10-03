import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import {
  AdvancedFiltersDrawer,
  EmptyState,
  JalaliDateRange,
  RtlPagination,
  StatusMessage,
} from "@/theme/shared-states";

test("shared states expose text semantics, Persian pagination and keyboard-safe drawer", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const page = vi.fn();
  const range = vi.fn();
  render(
    <>
      <StatusMessage kind="offline" title="ارتباط قطع است">
        آخرین داده نمایش داده می‌شود.
      </StatusMessage>
      <EmptyState
        variant="filter-empty"
        title="نتیجه‌ای یافت نشد"
        description="فیلترها را پاک کنید."
      />
      <RtlPagination page={2} count={4} onChange={page} />
      <JalaliDateRange from="۱۴۰۵/۰۱/۰۱" to="۱۴۰۵/۰۱/۳۰" onChange={range} />
      <AdvancedFiltersDrawer open onClose={close}>
        <button>اعمال فیلترها</button>
      </AdvancedFiltersDrawer>
    </>,
  );
  expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("ارتباط قطع است");
  expect(
    screen.getByRole("heading", { name: "نتیجه‌ای یافت نشد", hidden: true }),
  ).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "صفحه‌بندی", hidden: true })).toHaveAttribute(
    "dir",
    "rtl",
  );
  await user.click(screen.getByRole("button", { name: "صفحه بعد", hidden: true }));
  expect(page).toHaveBeenCalledWith(3);
  expect(screen.getByRole("dialog", { name: "فیلترهای پیشرفته" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(close).toHaveBeenCalled();
});
