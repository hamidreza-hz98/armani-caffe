import type { Metadata } from "next";

import { AccountActions } from "@/storefront/customer-account-control";
import styles from "@/storefront/storefront.module.css";
import { StorefrontShell } from "@/storefront/storefront-shell";

export const metadata: Metadata = {
  title: "پیش‌نمایش پوسته فروشگاه",
  robots: { index: false, follow: false },
};

export default function StorefrontPreview() {
  return (
    <StorefrontShell
      data={{
        businessName: "کافه آرمانی",
        account: { state: "customer", name: "سارا" },
        cartCount: 3,
        contacts: [
          {
            kind: "phone",
            label: "تماس با کافه",
            detail: "+989121234567",
            href: "tel:+989121234567",
          },
        ],
        contactAddress: "",
        settingsAvailable: true,
      }}
    >
      <section className={styles.hero}>
        <h1>پیش‌نمایش حساب مشتری</h1>
        <p>این صفحه فقط برای بررسی ظاهر پوستهٔ فروشگاه است و به حساب واقعی متصل نیست.</p>
        <AccountActions customer />
      </section>
    </StorefrontShell>
  );
}
