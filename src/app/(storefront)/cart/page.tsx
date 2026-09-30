import Link from "next/link";

import styles from "@/storefront/storefront.module.css";

export default function CartPage() {
  return (
    <section className={styles.hero}>
      <h1>سبد خرید</h1>
      <p>
        نمای سبد خرید در مرحلهٔ بعدی فروشگاه تکمیل می‌شود. هیچ سفارشی از این صفحه ثبت یا پرداخت
        نمی‌شود.
      </p>
      <p>
        <Link href="/">بازگشت به صفحهٔ اصلی</Link>
      </p>
    </section>
  );
}
