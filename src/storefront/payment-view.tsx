import Link from "next/link";

import type { OrderView } from "@/modules/orders";
import { formatJalaliDate, formatPersianNumber, formatToman } from "@/theme/format";

import type { PaymentResult } from "./payment-result";
import { paymentResultState } from "./payment-result";
import styles from "./payment-view.module.css";

function Summary({ order }: { order: OrderView }) {
  return (
    <section className={styles.card} aria-label="خلاصه سفارش">
      <h2>خلاصه سفارش</h2>
      <ul className={styles.items}>
        {order.items.map((item, index) => (
          <li key={`${item.productId}-${index}`}>
            <div>
              <strong>{item.productName}</strong>
              <span>{formatPersianNumber(item.quantity)} عدد</span>
            </div>
            {item.additions.length > 0 && (
              <small>{item.additions.map((addition) => addition.name).join("، ")}</small>
            )}
            <b>{formatToman(item.lineTotalToman)}</b>
          </li>
        ))}
      </ul>
      <p className={styles.total}>
        <span>مبلغ پرداخت‌شده</span>
        <strong>{formatToman(order.pricing.totalToman)}</strong>
      </p>
    </section>
  );
}

export function PaymentResultView({
  result,
  supportHref,
}: {
  result: PaymentResult;
  supportHref: string | null;
}) {
  const state = paymentResultState(result);
  const order = result.order;
  const heading =
    state === "success"
      ? "پرداخت و سفارش ثبت شد"
      : state === "failure"
        ? "پرداخت انجام نشد"
        : "وضعیت پرداخت در حال بررسی است";
  return (
    <div className={styles.page}>
      <div className={`${styles.hero} ${styles[state]}`}>
        <span className={styles.symbol} aria-hidden="true">
          {state === "success" ? "✓" : state === "failure" ? "!" : "…"}
        </span>
        <h1>{heading}</h1>
        <p role="status">
          {state === "success"
            ? "سفارش شما تأیید شد و کافه آن را دریافت کرده است. دریافت فقط به‌صورت حضوری است."
            : state === "failure"
              ? "سفارشی ثبت نشده و پرداخت تأیید نشده است. برای راهنمایی با کافه تماس بگیرید."
              : result.checkout.state === "RECOVERY_REQUIRED"
                ? "پرداخت تأیید شده، اما ثبت سفارش به بررسی کافه نیاز دارد. لطفاً پرداخت را تکرار نکنید."
                : "هنوز تأیید قطعی از درگاه و ثبت سفارش دریافت نشده است. لطفاً پرداخت را تکرار نکنید."}
        </p>
      </div>
      <section className={styles.card} aria-label="جزئیات پرداخت">
        <h2>جزئیات پرداخت</h2>
        <dl className={styles.facts}>
          {order && (
            <div>
              <dt>شماره سفارش</dt>
              <dd>
                <bdi dir="ltr">{order.code}</bdi>
              </dd>
            </div>
          )}
          <div>
            <dt>مبلغ</dt>
            <dd>{formatToman(order?.pricing.totalToman ?? result.checkout.totalToman)}</dd>
          </div>
          {(order?.transaction.reference || result.payment?.reference) && (
            <div>
              <dt>شماره پیگیری تراکنش</dt>
              <dd>
                <bdi dir="ltr">{order?.transaction.reference ?? result.payment?.reference}</bdi>
              </dd>
            </div>
          )}
          <div>
            <dt>{order ? "زمان ثبت سفارش" : "آخرین بررسی"}</dt>
            <dd>
              {order
                ? formatJalaliDate(order.placedAt, true)
                : result.payment
                  ? formatJalaliDate(result.payment.updatedAt, true)
                  : "هنوز ثبت نشده"}
            </dd>
          </div>
        </dl>
      </section>
      {order && <Summary order={order} />}
      <div className={styles.actions}>
        {state === "success" && order && (
          <Link className={styles.primary} href={`/orders/${order.id}`}>
            مشاهده و پیگیری سفارش
          </Link>
        )}
        {state === "pending" && (
          <a className={styles.primary} href={`/payment/result/${result.checkout.id}`}>
            بررسی دوباره وضعیت
          </a>
        )}
        <Link className={styles.secondary} href="/">
          بازگشت به منو
        </Link>
        {supportHref ? (
          <a className={styles.support} href={supportHref}>
            ارتباط با پشتیبانی کافه
          </a>
        ) : (
          <p className={styles.support}>
            برای پشتیبانی، از «ارتباط با ما» در بالای صفحه استفاده کنید.
          </p>
        )}
      </div>
    </div>
  );
}

export function CustomerOrderView({ order }: { order: OrderView }) {
  const statuses: Record<OrderView["status"], string> = {
    NEW: "ثبت‌شده",
    PREPARING: "در حال آماده‌سازی",
    READY: "آماده دریافت",
    COMPLETED: "تحویل‌شده",
    CANCELLED: "لغوشده",
  };
  return (
    <div className={styles.page}>
      <Link href="/" className={styles.back}>
        بازگشت به منو
      </Link>
      <div className={styles.hero}>
        <h1>
          سفارش <bdi dir="ltr">{order.code}</bdi>
        </h1>
        <p role="status">وضعیت سفارش: {statuses[order.status]}</p>
        <p>دریافت حضوری در کافه</p>
        {order.tableNumber && <p>میز {formatPersianNumber(order.tableNumber)}</p>}
      </div>
      <section className={styles.card}>
        <h2>اطلاعات سفارش</h2>
        <dl className={styles.facts}>
          <div>
            <dt>زمان ثبت</dt>
            <dd>{formatJalaliDate(order.placedAt, true)}</dd>
          </div>
          <div>
            <dt>پرداخت</dt>
            <dd>{order.paymentStatus === "paid" ? "پرداخت‌شده" : "بازپرداخت‌شده"}</dd>
          </div>
          {order.tableNumber && (
            <div>
              <dt>شمارهٔ میز</dt>
              <dd>{formatPersianNumber(order.tableNumber)}</dd>
            </div>
          )}
          <div>
            <dt>شماره پیگیری</dt>
            <dd>
              <bdi dir="ltr">{order.transaction.reference}</bdi>
            </dd>
          </div>
        </dl>
      </section>
      <Summary order={order} />
      <a className={styles.secondary} href={`/api/customer/orders/${order.id}/invoice/print`}>
        نسخه چاپی فاکتور
      </a>
    </div>
  );
}
