"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { publicConfig } from "@/config/public";
import type { OrderStatus } from "@/modules/orders";
import { useFeedback } from "@/theme/feedback-provider";

import styles from "./detail.module.css";
import type { OrderDetailData } from "./detail-server";

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
const statusNames: Record<OrderStatus, string> = {
  NEW: "جدید",
  PREPARING: "در حال آماده‌سازی",
  READY: "آماده تحویل",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};
const milestones: OrderStatus[] = ["NEW", "PREPARING", "READY", "COMPLETED"];
const next: Partial<Record<OrderStatus, OrderStatus>> = {
  NEW: "PREPARING",
  PREPARING: "READY",
  READY: "COMPLETED",
};
const printNames = { queued: "در صف", printing: "در حال چاپ", printed: "چاپ‌شده", dead: "ناموفق" };
const money = (value: number) => `${new Intl.NumberFormat("fa-IR").format(value)} تومان`;
const number = (value: number) => new Intl.NumberFormat("fa-IR").format(value);
const date = (value: string) =>
  new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
const printLabel = (job: OrderDetailData["printJobs"][number]) =>
  job.status === "queued" && job.attempts > 0 ? "در انتظار تلاش مجدد" : printNames[job.status];
async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("ارتباط برقرار نشد. دوباره تلاش کنید.");
  }
  let result: Envelope<T>;
  try {
    result = (await response.json()) as Envelope<T>;
  } catch {
    throw new Error("پاسخ سرویس معتبر نیست. دوباره تلاش کنید.");
  }
  if (!response.ok || !result.ok)
    throw new Error(
      !result.ok && result.error.code === "CONFLICT"
        ? "اطلاعات سفارش تغییر کرده است؛ دوباره بررسی کنید."
        : !result.ok && result.error.code === "FORBIDDEN"
          ? "اجازه انجام این عمل را ندارید."
          : "درخواست انجام نشد. دوباره تلاش کنید.",
    );
  return result.value;
}
function socketUrl(role: "admin" | "orders") {
  const url = new URL(publicConfig.webSocketUrl);
  url.searchParams.set("role", role);
  return url;
}
export function OrderDetail({
  initial,
  canManage,
  isOwner,
  canReprint,
}: {
  initial: OrderDetailData;
  canManage: boolean;
  isOwner: boolean;
  canReprint: boolean;
}) {
  const feedback = useFeedback();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [bridge, setBridge] = useState<"checking" | "online" | "offline" | "unknown">("checking");
  const [socketState, setSocketState] = useState<"connecting" | "online" | "offline">("connecting");
  const mounted = useRef(true);
  const serial = useRef(0);
  const reload = useCallback(async () => {
    const current = ++serial.current;
    try {
      const result = await request<OrderDetailData>(
        `/api/admin/orders/${initial.order.id}/operations`,
      );
      if (!mounted.current || current !== serial.current) return;
      setData(result);
      setStale(false);
      setError("");
    } catch {
      if (mounted.current && current === serial.current) {
        setStale(true);
        setError("به‌روزرسانی جزئیات ممکن نشد؛ داده‌ها ممکن است قدیمی باشند.");
      }
    }
  }, [initial.order.id]);
  useEffect(() => {
    mounted.current = true;
    const sockets: WebSocket[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let stopped = false;
    const connect = (role: "admin" | "orders", attempt = 0) => {
      if (stopped) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(socketUrl(role));
      } catch {
        timers.push(setTimeout(() => connect(role, attempt + 1), 30_000));
        return;
      }
      sockets.push(socket);
      socket.onopen = () => {
        if (role === "admin") {
          setSocketState("online");
          setBridge("checking");
        }
        void reload();
      };
      socket.onmessage = (event) => {
        let value: unknown;
        try {
          value = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!value || typeof value !== "object") return;
        const item = value as Record<string, unknown>;
        if (item.v !== 1) return;
        if (role === "admin") {
          if (item.type === "admin.ready") setBridge("offline");
          if (
            item.type === "bridge.presence" &&
            item.printerId === data.invoice?.printing.printerId &&
            typeof item.online === "boolean"
          )
            setBridge(item.online ? "online" : "offline");
          if (
            item.type === "print.status" &&
            item.job &&
            typeof item.job === "object" &&
            (item.job as { orderId?: unknown }).orderId === initial.order.id
          )
            void reload();
        } else if (item.type === "order.changed" && item.orderId === initial.order.id)
          void reload();
      };
      socket.onclose = () => {
        if (stopped) return;
        if (role === "admin") {
          setSocketState("offline");
          setBridge("unknown");
        }
        timers.push(
          setTimeout(
            () => connect(role, attempt + 1),
            Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)),
          ),
        );
      };
      socket.onerror = () => socket.close();
    };
    connect("admin");
    connect("orders");
    const interval = setInterval(() => {
      if (navigator.onLine) void reload();
    }, 15_000);
    const visible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      mounted.current = false;
      for (const socket of sockets) socket.close();
      for (const timer of timers) clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [initial.order.id, reload, data.invoice?.printing.printerId]);
  const order = data.order;
  const nextStatus = next[order.status];
  const printerId = data.invoice?.printing.printerId ?? "";
  async function act(path: string, body: object, success: string) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(path, body);
      await reload();
      setMessage(success);
      return true;
    } catch (cause) {
      await reload();
      setError(cause instanceof Error ? cause.message : "درخواست انجام نشد.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function advance() {
    if (
      !nextStatus ||
      !(await feedback.confirm({
        title: "تغییر وضعیت سفارش؟",
        description: `وضعیت سفارش به «${statusNames[nextStatus]}» تغییر می‌کند.`,
        confirmLabel: "تغییر وضعیت",
        dangerous: false,
      }))
    )
      return;
    void act(
      `/api/admin/orders/${order.id}/status`,
      { revision: order.revision, status: nextStatus },
      "وضعیت سفارش به‌روز شد.",
    );
  }
  async function cancel() {
    const reason = await feedback.requestText({
      title: "لغو سفارش",
      description: "دلیل لغو در گزارش فعالیت ثبت می‌شود.",
      label: "دلیل لغو",
      submitLabel: "ادامه",
      maxLength: 300,
    });
    if (
      !reason ||
      !(await feedback.confirm({
        title: "لغو سفارش تأیید شود؟",
        description: "این تغییر قابل بازگشت نیست. بازگشت وجه، در صورت نیاز، جداگانه انجام می‌شود.",
        confirmLabel: "لغو سفارش",
        dangerous: true,
        requiredText: "لغو",
      }))
    )
      return;
    void act(
      `/api/admin/orders/${order.id}/status`,
      { revision: order.revision, status: "CANCELLED", reason },
      "سفارش لغو شد. بازگشت وجه، در صورت نیاز، مرحله‌ای جداگانه است.",
    );
  }
  async function refund() {
    const reason = await feedback.requestText({
      title: "درخواست بازگشت وجه",
      description: "این درخواست به‌معنای بازگشت قطعی پول نیست.",
      label: "دلیل درخواست",
      submitLabel: "ادامه",
      maxLength: 300,
    });
    if (
      !reason ||
      !(await feedback.confirm({
        title: "درخواست ثبت شود؟",
        description: "نتیجهٔ درگاه باید پس از ثبت درخواست جداگانه تأیید شود.",
        confirmLabel: "ثبت درخواست",
        dangerous: true,
      }))
    )
      return;
    void act(
      `/api/admin/orders/${order.id}/refund`,
      { revision: order.revision, reason },
      "درخواست بازگشت وجه ثبت شد؛ نتیجه باید جداگانه تأیید شود.",
    );
  }
  async function reprint() {
    if (
      !data.invoice ||
      !(await feedback.confirm({
        title: "چاپ مجدد فاکتور؟",
        description: `فاکتور ${data.invoice.number} با همان محتوای ثبت‌شده دوباره چاپ می‌شود.`,
        confirmLabel: "ثبت چاپ مجدد",
        dangerous: false,
      }))
    )
      return;
    const storageKey = `armani.orders.reprint.${order.id}`;
    const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID().replaceAll("-", "");
    sessionStorage.setItem(storageKey, key);
    void act(
      `/api/admin/orders/${order.id}/invoice/reprint`,
      { idempotencyKey: key, paperWidthMm: data.invoice.paperWidthMm },
      "تلاش چاپ مجدد ثبت شد. وضعیت چاپ را تا دریافت تأیید چاپگر پیگیری کنید.",
    ).then((succeeded) => {
      if (succeeded) sessionStorage.removeItem(storageKey);
    });
  }
  return (
    <div dir="rtl" className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link href="/dashboard/orders">سفارش‌ها</Link>
        <span aria-hidden="true"> / </span>
        <span dir="ltr">{order.code}</span>
      </nav>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>جزئیات سفارش</p>
          <h1>
            <span>سفارش</span> <bdi>{order.code}</bdi>
          </h1>
          <p>
            {date(order.placedAt)} · نسخه {number(order.revision)}
          </p>
          {order.tableNumber && <p>شمارهٔ میز: {number(order.tableNumber)}</p>}
        </div>
        <div className={styles.headerActions}>
          <a
            href={`/api/admin/orders/${order.id}/invoice/print`}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!data.invoice}
            onClick={(event) => {
              if (!data.invoice) event.preventDefault();
            }}
          >
            پیش‌نمایش چاپ
          </a>
          <button type="button" onClick={() => void reload()}>
            به‌روزرسانی
          </button>
        </div>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      {stale && (
        <p className={styles.warning} role="status">
          این اطلاعات ممکن است قدیمی باشد. پیش از اقدام دوباره به‌روزرسانی کنید.
        </p>
      )}
      <section className={styles.timeline} aria-label="مراحل سفارش">
        <h2>وضعیت سفارش</h2>
        <ol>
          {milestones.map((step, index) => (
            <li
              key={step}
              className={
                order.status !== "CANCELLED" && milestones.indexOf(order.status) >= index
                  ? styles.done
                  : ""
              }
            >
              <span>{number(index + 1)}</span>
              {statusNames[step]}
            </li>
          ))}
        </ol>
        {order.status === "CANCELLED" && <p className={styles.error}>این سفارش لغو شده است.</p>}
      </section>
      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={styles.card}>
            <h2>اقلام ثبت‌شده</h2>
            {order.items.map((item, index) => (
              <article className={styles.line} key={`${item.productId}-${index}`}>
                <div>
                  <strong>{item.productName}</strong>
                  <p>
                    {item.categoryName} · {number(item.quantity)} عدد
                  </p>
                  {item.additions.length > 0 && (
                    <ul>
                      {item.additions.map((addition) => (
                        <li key={addition.additionId}>
                          {addition.name} ({money(addition.priceToman)})
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.note && <p>یادداشت قلم: {item.note}</p>}
                </div>
                <strong>{money(item.lineTotalToman)}</strong>
              </article>
            ))}
            <div className={styles.total}>
              <span>جمع سفارش</span>
              <strong>{money(order.pricing.totalToman)}</strong>
            </div>
            <p className={styles.muted}>
              مبالغ و اقلام، تصویر ثابت زمان ثبت سفارش هستند و با تغییر منو عوض نمی‌شوند.
            </p>
          </section>
          <div className={styles.twoColumns}>
            <section className={styles.card}>
              <h2>یادداشت مشتری</h2>
              <p>{order.notes || "یادداشتی ثبت نشده است."}</p>
            </section>
            <section className={styles.card}>
              <h2>مشتری</h2>
              <p>{order.customer.displayName ?? "مشتری"}</p>
              <p dir="ltr">{order.customer.phone}</p>
            </section>
          </div>
          <section className={styles.card}>
            <h2>مصرف موجودی</h2>
            {data.stock.length ? (
              <div className={styles.scroll}>
                <table>
                  <thead>
                    <tr>
                      <th>قلم</th>
                      <th>نوع</th>
                      <th>تغییر</th>
                      <th>قبل</th>
                      <th>بعد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stock.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.reason}</td>
                        <td dir="ltr">
                          {number(item.delta)} {item.unit}
                        </td>
                        <td>{number(item.before)}</td>
                        <td>{number(item.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.muted}>حرکت موجودی برای این سفارش ثبت نشده است.</p>
            )}
          </section>
          <section className={styles.card}>
            <h2>فعالیت سفارش</h2>
            {data.activity.length ? (
              <ol className={styles.activity}>
                {data.activity.map((item) => (
                  <li key={item.id}>
                    <strong>{item.action}</strong>
                    <span>
                      {item.area} · {item.actorKind} · {date(item.at)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.muted}>رویدادی برای نمایش ثبت نشده است.</p>
            )}
          </section>
        </div>
        <aside className={styles.sideColumn}>
          <section className={styles.card}>
            <h2>اقدام بعدی</h2>
            <p>
              وضعیت فعلی: <strong>{statusNames[order.status]}</strong>
            </p>
            {canManage && nextStatus && (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || stale}
                onClick={advance}
              >
                تغییر به {statusNames[nextStatus]}
              </button>
            )}
            {isOwner && (order.status === "NEW" || order.status === "PREPARING") && (
              <button
                type="button"
                className={styles.danger}
                disabled={busy || stale}
                onClick={cancel}
              >
                لغو سفارش
              </button>
            )}
            {isOwner &&
              order.status === "CANCELLED" &&
              order.paymentStatus === "paid" &&
              order.refundStatus === "NONE" && (
                <button type="button" disabled={busy || stale} onClick={refund}>
                  درخواست بازگشت وجه
                </button>
              )}
            {order.refundStatus === "REQUESTED" && (
              <p className={styles.warning}>
                درخواست بازگشت وجه ثبت شده؛ بازپرداخت هنوز تأیید نشده است.
              </p>
            )}
          </section>
          <section className={styles.card}>
            <h2>پرداخت و تراکنش</h2>
            <dl>
              <dt>وضعیت پرداخت</dt>
              <dd>{order.paymentStatus === "paid" ? "پرداخت تأییدشده" : "بازگشت وجه"}</dd>
              <dt>درگاه</dt>
              <dd>{order.transaction.provider}</dd>
              <dt>شناسه تراکنش</dt>
              <dd dir="ltr">{order.transaction.id}</dd>
              <dt>مرجع</dt>
              <dd dir="ltr">{order.transaction.reference}</dd>
              <dt>مبلغ</dt>
              <dd>{money(data.transaction?.amountToman ?? order.pricing.totalToman)}</dd>
              <dt>تأیید</dt>
              <dd>{data.transaction?.status ?? "نامشخص"}</dd>
            </dl>
            {isOwner && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (
                    await feedback.confirm({
                      title: "استعلام تراکنش؟",
                      description: "وضعیت تراکنش مستقیماً از درگاه دوباره بررسی می‌شود.",
                      confirmLabel: "انجام استعلام",
                      dangerous: false,
                    })
                  )
                    void act(
                      `/api/admin/orders/${order.id}/verify`,
                      {},
                      "استعلام تراکنش انجام شد.",
                    );
                }}
              >
                استعلام معتبر تراکنش
              </button>
            )}
          </section>
          <section className={styles.card}>
            <h2>فاکتور ثبت‌شده</h2>
            {data.invoice ? (
              <>
                <p>
                  {data.invoice.identity.title} · <bdi>{data.invoice.number}</bdi>
                </p>
                <p>{data.invoice.jalaliDateTime}</p>
                <div className={styles.receipt}>
                  {data.invoice.lines.map((line, index) => (
                    <div key={index}>
                      {number(line.quantity)} × {line.productName}{" "}
                      <strong>{money(line.lineTotalToman)}</strong>
                    </div>
                  ))}
                  <hr />
                  <strong>جمع: {money(data.invoice.totalToman)}</strong>
                  <p>{data.invoice.identity.footer}</p>
                </div>
                <p>عرض کاغذ: {number(data.invoice.paperWidthMm)} میلی‌متر</p>
                <a
                  href={`/api/admin/orders/${order.id}/invoice/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  نمای چاپ فاکتور
                </a>
                {canReprint && (
                  <button type="button" disabled={busy} onClick={reprint}>
                    چاپ مجدد با تأیید
                  </button>
                )}
              </>
            ) : (
              <p className={styles.warning}>فاکتور در دسترس نیست؛ چاپ مجدد غیرفعال است.</p>
            )}
          </section>
          <section className={styles.card}>
            <h2>وضعیت چاپ</h2>
            <p className={styles.muted}>
              اتصال زنده:{" "}
              {socketState === "online"
                ? "برقرار"
                : socketState === "connecting"
                  ? "در حال بررسی"
                  : "قطع"}{" "}
              · پل چاپ:{" "}
              {bridge === "online"
                ? "متصل"
                : bridge === "offline"
                  ? "آفلاین"
                  : bridge === "checking"
                    ? "در حال بررسی"
                    : "نامشخص"}
            </p>
            {!data.printJobs.length ? (
              <p>هنوز تلاش چاپی ثبت نشده است.</p>
            ) : (
              <ol className={styles.jobs}>
                {data.printJobs.map((job) => (
                  <li key={job.id}>
                    <strong>
                      {job.source === "automatic" ? "چاپ خودکار" : "چاپ مجدد"}: {printLabel(job)}
                    </strong>
                    <small>
                      چاپگر {job.printerId} · تلاش {number(job.attempts)} از{" "}
                      {number(job.maxAttempts)}
                    </small>
                    {job.status === "queued" &&
                      bridge === "offline" &&
                      job.printerId === printerId && (
                        <span className={styles.warning}>پل چاپگر آفلاین است؛ صف حفظ می‌شود.</span>
                      )}
                    {job.nextAttemptAt && job.attempts > 0 && (
                      <small>تلاش بعدی: {date(job.nextAttemptAt)}</small>
                    )}
                    {job.printedAt && <small>تأیید چاپ: {date(job.printedAt)}</small>}
                    {job.lastFailureCode && <small>خطای چاپ: {job.lastFailureCode}</small>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
