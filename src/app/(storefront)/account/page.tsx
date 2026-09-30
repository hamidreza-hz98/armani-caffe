import Link from "next/link";

import styles from "@/storefront/storefront.module.css";

export default function AccountPage() {
  return (
    <section className={styles.hero}>
      <h1>حساب کاربری</h1>
      <p>
        ورود و مدیریت حساب در مرحلهٔ بعدی فروشگاه تکمیل می‌شود. فعلاً می‌توانید از راه‌های ارتباطی
        بالای صفحه با کافه در تماس باشید.
      </p>
      <p>
        <Link href="/">بازگشت به صفحهٔ اصلی</Link>
      </p>
    </section>
  );
}
