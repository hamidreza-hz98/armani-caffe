import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";

import { ContactSheet } from "../../src/storefront/contact-sheet.tsx";
import { StorefrontShell } from "../../src/storefront/storefront-shell.tsx";

test("contact sheet opens, presents safe link, and closes accessibly", async () => {
  render(
    <ContactSheet
      links={[
        {
          kind: "phone",
          label: "تماس با کافه",
          detail: "+989121234567",
          href: "tel:+989121234567",
        },
      ]}
      address=""
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "ارتباط با ما" }));
  expect(screen.getByRole("dialog", { name: "ارتباط با کافه آرمانی" })).toBeVisible();
  expect(screen.getByRole("link", { name: /تماس با کافه/ })).toHaveAttribute(
    "href",
    "tel:+989121234567",
  );
  fireEvent.click(screen.getByRole("button", { name: "بستن پنجره ارتباط" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "ارتباط با کافه آرمانی" })).not.toBeInTheDocument(),
  );
});

test("signed-in header shows customer name and Persian cart count", () => {
  render(
    <StorefrontShell
      data={{
        businessName: "کافه آرمانی",
        account: { state: "customer", name: "سارا" },
        cartCount: 3,
        contacts: [],
        contactAddress: "",
        settingsAvailable: true,
      }}
    >
      <p>محتوا</p>
    </StorefrontShell>,
  );
  expect(screen.getByRole("link", { name: "حساب سارا" })).toBeVisible();
  expect(screen.getByRole("link", { name: "سبد خرید، ۳ کالا" })).toBeVisible();
  expect(screen.getByRole("link", { name: "حمیدرضا حسن‌زاده" })).toHaveAttribute(
    "href",
    "https://www.instagram.com/hamidreza_hz98",
  );
});
