import "server-only";

import Link from "next/link";
import type { ReactNode } from "react";

import type { DashboardLink } from "@/dashboard/navigation";
import type {
  OverviewAttention,
  OverviewCustomer,
  OverviewDay,
  OverviewOrder,
  OverviewProduct,
  OverviewRange,
  OverviewSales,
  OverviewStock,
} from "@/modules/analytics";
import { logEvent } from "@/server/observability";

import styles from "./overview.module.css";
import { LazySalesChart } from "./sales-chart-loader";

const number = new Intl.NumberFormat("fa-IR");
const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  timeZone: "Asia/Tehran",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const day = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  timeZone: "Asia/Tehran",
  month: "short",
  day: "numeric",
});
const price = (value: number) => `${number.format(value)} تومان`;
const orderStatus: Record<string, string> = {
  NEW: "جدید",
  PREPARING: "در حال آماده‌سازی",
  READY: "آماده تحویل",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};
const stockUnit: Record<string, string> = { gram: "گرم", milliliter: "میلی‌لیتر", piece: "عدد" };

async function Widget<T>({
  data,
  name,
  retryUrl,
  children,
}: {
  data: Promise<T>;
  name: string;
  retryUrl: string;
  children: (value: T) => ReactNode;
}) {
  try {
    return children(await data);
  } catch (error) {
    logEvent("error", "dashboard.widget_failed", { widget: name, error });
    return (
      <section className={styles.card} role="status" aria-label={name}>
        <h2>{name}</h2>
        <p>بارگذاری این بخش ممکن نشد. بخش‌های دیگر همچنان در دسترس هستند.</p>
        <a className={styles.retry} href={retryUrl}>
          تلاش دوباره
        </a>
      </section>
    );
  }
}

export function WidgetSkeleton({ title }: { title: string }) {
  return (
    <section
      className={`${styles.card} ${styles.skeleton}`}
      aria-label={`در حال بارگذاری ${title}`}
    >
      <h2>{title}</h2>
      <div className={styles.skeletonLine} />
      <div className={styles.skeletonLine} />
      <div className={styles.skeletonLine} />
    </section>
  );
}

export function AttentionWidget({
  data,
  retryUrl,
}: {
  data: Promise<OverviewAttention>;
  retryUrl: string;
}) {
  return (
    <Widget data={data} name="سفارش‌های باز" retryUrl={retryUrl}>
      {(value) => (
        <section className={`${styles.card} ${styles.actionCard}`} aria-label="سفارش‌های باز">
          <div className={styles.cardTop}>
            <h2>سفارش‌های نیازمند پیگیری</h2>
            <span className={styles.alertMark}>●</span>
          </div>
          <strong className={styles.largeNumber}>{number.format(value.count)}</strong>
          <p>
            {value.count
              ? "سفارش پرداخت‌شده هنوز تکمیل نشده است."
              : "سفارشی در انتظار پیگیری نیست."}
          </p>
          {value.recent.length > 0 && (
            <ul className={styles.miniList}>
              {value.recent.map((item) => (
                <li key={item.code}>
                  <b dir="ltr">{item.code}</b>
                  <span>{orderStatus[item.status] ?? item.status}</span>
                </li>
              ))}
            </ul>
          )}
          <Link className={styles.textLink} href="/dashboard/orders">
            مشاهده سفارش‌ها ←
          </Link>
        </section>
      )}
    </Widget>
  );
}

export function StockWidget({
  data,
  retryUrl,
  compact = false,
}: {
  data: Promise<OverviewStock>;
  retryUrl: string;
  compact?: boolean;
}) {
  const name = compact ? "موجودی کم" : "اقلام کم‌موجودی";
  return (
    <Widget data={data} name={name} retryUrl={retryUrl}>
      {(value) => (
        <section className={`${styles.card} ${compact ? styles.actionCard : ""}`} aria-label={name}>
          <div className={styles.cardTop}>
            <h2>{name}</h2>
            {compact && <span className={styles.alertMark}>◆</span>}
          </div>
          {compact ? (
            <>
              <strong className={styles.largeNumber}>{number.format(value.count)}</strong>
              <p>
                {value.count ? "قلم به حد سفارش مجدد رسیده است." : "همه اقلام موجودی کافی دارند."}
              </p>
            </>
          ) : value.items.length ? (
            <ul className={styles.list}>
              {value.items.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <strong>
                    {number.format(item.onHand)} {stockUnit[item.unit]}{" "}
                    <small>از حد {number.format(item.reorderLevel)}</small>
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>موردی برای پیگیری نیست.</p>
          )}
          <Link className={styles.textLink} href="/dashboard/inventory">
            مشاهده انبار ←
          </Link>
        </section>
      )}
    </Widget>
  );
}

export function MetricsWidget({
  data,
  range,
  retryUrl,
}: {
  data: Promise<OverviewSales>;
  range: OverviewRange;
  retryUrl: string;
}) {
  return (
    <Widget data={data} name="شاخص‌های فروش" retryUrl={retryUrl}>
      {(value) => (
        <div className={styles.metrics}>
          {[
            ["فروش امروز", price(value.today.salesToman), "تا این لحظه، به وقت تهران"],
            [`فروش ${range} روز`, price(value.selected.salesToman), "سفارش‌های پرداخت‌شده"],
            [`سفارش ${range} روز`, number.format(value.selected.orderCount), "تعداد سفارش"],
            [
              "میانگین سبد خرید",
              price(value.selected.averageOrderValueToman),
              `در ${range} روز اخیر`,
            ],
          ].map(([label, amount, caption]) => (
            <section className={styles.metric} key={label}>
              <h3>{label}</h3>
              <strong>{amount}</strong>
              <p>{caption}</p>
            </section>
          ))}
        </div>
      )}
    </Widget>
  );
}

export function TrendWidget({
  data,
  range,
  retryUrl,
}: {
  data: Promise<readonly OverviewDay[]>;
  range: OverviewRange;
  retryUrl: string;
}) {
  return (
    <Widget data={data} name="روند فروش" retryUrl={retryUrl}>
      {(values) => (
        <section className={styles.card} aria-label={`روند فروش ${range} روز`}>
          <div className={styles.cardTop}>
            <div>
              <h2>روند فروش {number.format(range)} روزه</h2>
              <p>سفارش‌های پرداخت‌شده، به وقت تهران</p>
            </div>
            <span className={styles.legend}>● فروش روزانه</span>
          </div>
          {values.every((item) => item.salesToman === 0) ? (
            <p className={styles.empty}>هنوز فروشی در این بازه ثبت نشده است.</p>
          ) : (
            <LazySalesChart values={values} />
          )}
          <details className={styles.chartData}>
            <summary>داده‌های روزانه نمودار</summary>
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>روز</th>
                    <th>فروش</th>
                    <th>سفارش</th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((item) => (
                    <tr key={item.date}>
                      <th>{day.format(new Date(`${item.date}T12:00:00Z`))}</th>
                      <td>{price(item.salesToman)}</td>
                      <td>{number.format(item.orderCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
    </Widget>
  );
}

export function LatestOrdersWidget({
  data,
  retryUrl,
}: {
  data: Promise<readonly OverviewOrder[]>;
  retryUrl: string;
}) {
  return (
    <Widget data={data} name="آخرین سفارش‌ها" retryUrl={retryUrl}>
      {(values) => (
        <section className={styles.card} aria-label="آخرین سفارش‌ها">
          <div className={styles.cardTop}>
            <h2>آخرین سفارش‌ها</h2>
            <Link className={styles.textLink} href="/dashboard/orders">
              همه سفارش‌ها ←
            </Link>
          </div>
          {values.length ? (
            <ul className={styles.list}>
              {values.map((item) => (
                <li key={item.id}>
                  <span>
                    <b dir="ltr">{item.code}</b>
                    <small>
                      {item.customerName ?? "مشتری"} · {date.format(new Date(item.placedAt))}
                    </small>
                  </span>
                  <span className={styles.listEnd}>
                    <strong>{price(item.totalToman)}</strong>
                    <small>
                      {item.paymentStatus === "refunded"
                        ? "بازپرداخت‌شده"
                        : (orderStatus[item.status] ?? item.status)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>هنوز سفارشی ثبت نشده است.</p>
          )}
        </section>
      )}
    </Widget>
  );
}

export function ProductsWidget({
  data,
  retryUrl,
}: {
  data: Promise<readonly OverviewProduct[]>;
  retryUrl: string;
}) {
  return (
    <Widget data={data} name="محصولات پرفروش" retryUrl={retryUrl}>
      {(values) => (
        <section className={styles.card} aria-label="محصولات پرفروش">
          <h2>
            محصولات پرفروش <small>۳۰ روز اخیر</small>
          </h2>
          {values.length ? (
            <ol className={styles.list}>
              {values.map((item) => (
                <li key={item.productId}>
                  <span>
                    {item.name}
                    <small>{number.format(item.quantity)} عدد فروش</small>
                  </span>
                  <strong>{price(item.salesToman)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>هنوز داده‌ای برای رتبه‌بندی نیست.</p>
          )}
        </section>
      )}
    </Widget>
  );
}

export function CustomersWidget({
  data,
  retryUrl,
}: {
  data: Promise<readonly OverviewCustomer[]>;
  retryUrl: string;
}) {
  return (
    <Widget data={data} name="مشتریان برتر" retryUrl={retryUrl}>
      {(values) => (
        <section className={styles.card} aria-label="مشتریان برتر">
          <h2>
            مشتریان برتر <small>۳۰ روز اخیر</small>
          </h2>
          {values.length ? (
            <ol className={styles.list}>
              {values.map((item) => (
                <li key={item.customerId}>
                  <span>
                    {item.displayName ?? "مشتری"}
                    <small>{number.format(item.orderCount)} سفارش</small>
                  </span>
                  <strong>{price(item.spentToman)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>هنوز داده‌ای برای رتبه‌بندی نیست.</p>
          )}
        </section>
      )}
    </Widget>
  );
}

export function Shortcuts({ links }: { links: readonly DashboardLink[] }) {
  const relevant = links.filter((link) => link.href !== "/dashboard").slice(0, 4);
  return (
    <section className={styles.card} aria-label="دسترسی سریع">
      <h2>دسترسی سریع</h2>
      <div className={styles.shortcuts}>
        {relevant.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
            <span aria-hidden>←</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
