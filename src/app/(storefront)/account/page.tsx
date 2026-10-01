import { AccountActions } from "@/storefront/customer-account-control";
import { loadStorefrontShell } from "@/storefront/data";
import styles from "@/storefront/storefront.module.css";

export default async function AccountPage() {
  const { account } = await loadStorefrontShell();
  return (
    <section className={styles.hero}>
      <h1>حساب کاربری</h1>
      <p>
        {account.state === "customer"
          ? `${account.name ?? "مشتری عزیز"}، به حساب خود خوش آمدید.`
          : account.state === "guest"
            ? "برای مشاهده سفارش‌ها و مدیریت حساب وارد شوید."
            : "وضعیت حساب در دسترس نیست. اتصال خود را بررسی کنید."}
      </p>
      <div className={styles.accountActions}>
        <AccountActions customer={account.state === "customer"} />
      </div>
    </section>
  );
}
