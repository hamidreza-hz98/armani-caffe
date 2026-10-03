"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { publicConfig } from "@/config/public";
import { useFeedback } from "@/theme/feedback-provider";
import { EmptyState, RtlPagination, StatusMessage } from "@/theme/shared-states";

import {
  nextBatchStatus,
  orderFilterParams,
  type OrderFilters,
  type OrderList,
  type OrderRow,
  parseOrderNotice,
} from "./model";
import styles from "./orders.module.css";

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
const statusNames = {
  NEW: "جدید",
  PREPARING: "در حال آماده‌سازی",
  READY: "آماده",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};
const paymentNames = {
  unpaid: "پرداخت‌نشده",
  pending: "در انتظار پرداخت",
  paid: "پرداخت‌شده",
  refunded: "بازگشت وجه",
};
const money = (value: number) => `${new Intl.NumberFormat("fa-IR").format(value)} تومان`;
const date = (value: string) =>
  new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as Envelope<T>;
  if (!response.ok || !data.ok)
    throw new Error(
      !data.ok && data.error.code === "CONFLICT"
        ? "سفارش تغییر کرده است؛ فهرست را تازه کنید."
        : "درخواست انجام نشد. دوباره تلاش کنید.",
    );
  return data.value;
}
const listUrl = (filters: OrderFilters) =>
  `/api/admin/orders/operations?${orderFilterParams(filters)}`;
const pageUrl = (filters: OrderFilters) => `/dashboard/orders?${orderFilterParams(filters)}`;
const savedKey = "armani.orders.quick-filters.v1";
type SavedFilter = {
  name: string;
  status: OrderFilters["status"];
  payment: OrderFilters["payment"];
  range: OrderFilters["range"];
  sort: OrderFilters["sort"];
};
function readSaved(): SavedFilter[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(savedKey) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is SavedFilter =>
              item &&
              typeof item.name === "string" &&
              item.name.length <= 24 &&
              ["all", "NEW", "PREPARING", "READY", "COMPLETED", "CANCELLED"].includes(
                item.status,
              ) &&
              ["all", "unpaid", "pending", "paid", "refunded"].includes(item.payment) &&
              ["all", "today", "7d", "30d"].includes(item.range) &&
              ["newest", "oldest", "amount-high", "amount-low"].includes(item.sort),
          )
          .slice(0, 5)
      : [];
  } catch {
    return [];
  }
}
function ping() {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.06, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
  oscillator.onended = () => {
    void context.close();
  };
}
export function OrderManager({
  initial,
  filters,
  canManage,
}: {
  initial: OrderList;
  filters: OrderFilters;
  canManage: boolean;
}) {
  const router = useRouter();
  const feedback = useFeedback();
  const [list, setList] = useState(initial);
  const [draft, setDraft] = useState(filters);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [sound, setSound] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const seen = useRef(new Set<string>());
  const mounted = useRef(true);
  const soundRef = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSaved(readSaved());
      setSound(localStorage.getItem("armani.orders.sound") === "on");
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await api<OrderList>(listUrl(filters));
      if (!mounted.current || request !== sequence.current) return;
      setList(next);
      setSelected((current) => current.filter((id) => next.items.some((item) => item.id === id)));
      setStale(false);
      setError("");
    } catch {
      if (mounted.current && request === sequence.current) {
        setStale(true);
        setError("به‌روزرسانی سفارش‌ها ممکن نشد. داده‌ها ممکن است قدیمی باشند.");
      }
    }
  }, [filters]);
  useEffect(() => {
    mounted.current = true;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      try {
        const url = new URL(publicConfig.webSocketUrl);
        url.searchParams.set("role", "orders");
        socket = new WebSocket(url);
        socket.onopen = () => {
          attempt = 0;
          setConnection("online");
          void reload();
        };
        socket.onmessage = (message) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(String(message.data));
          } catch {
            return;
          }
          const event = parseOrderNotice(parsed);
          if (!event || seen.current.has(event.eventId)) return;
          seen.current.add(event.eventId);
          if (seen.current.size > 500) seen.current.delete(seen.current.values().next().value!);
          if (event.change === "order.confirmed") {
            setNotice("سفارش تازه دریافت شد.");
            if (
              soundRef.current &&
              document.visibilityState === "visible" &&
              Date.now() - Date.parse(event.at) < 120_000
            )
              ping();
          }
          void reload();
        };
        socket.onclose = () => {
          if (stopped) return;
          setConnection("offline");
          void reload();
          timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)));
        };
        socket.onerror = () => socket?.close();
      } catch {
        setConnection("offline");
        void reload();
        timer = setTimeout(connect, 30_000);
      }
    };
    connect();
    const interval = setInterval(() => {
      if (navigator.onLine) void reload();
    }, 30_000);
    const visibility = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    return () => {
      stopped = true;
      mounted.current = false;
      socket?.close();
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", visibility);
    };
  }, [reload]);
  const chosen = list.items.filter((item) => selected.includes(item.id));
  const batchTarget = nextBatchStatus(chosen);
  const submit = (value: OrderFilters) => router.push(pageUrl({ ...value, page: 1 }));
  async function transition(rows: OrderRow[], status: OrderRow["status"]) {
    if (!canManage || busy || !rows.length) return;
    if (
      !(await feedback.confirm({
        title: "تغییر وضعیت سفارش‌ها؟",
        description: `وضعیت ${rows.length.toLocaleString("fa-IR")} سفارش به «${statusNames[status]}» تغییر می‌کند.`,
        confirmLabel: "تغییر وضعیت",
        dangerous: false,
      }))
    )
      return;
    setBusy(true);
    setError("");
    let failed = 0;
    for (const row of rows) {
      try {
        await api(`/api/admin/orders/${row.id}/status`, { revision: row.revision, status });
      } catch {
        failed += 1;
      }
    }
    await reload();
    setSelected([]);
    setBusy(false);
    setNotice(
      failed
        ? `${failed} سفارش تغییر نکرد. وضعیت‌های فعلی را بررسی کنید.`
        : "وضعیت سفارش‌ها به‌روز شد.",
    );
  }
  function saveFilter() {
    const name = window.prompt("نام فیلتر سریع (بدون اطلاعات مشتری):")?.trim().slice(0, 24);
    if (!name) return;
    const next = [
      ...saved.filter((item) => item.name !== name),
      {
        name,
        status: filters.status,
        payment: filters.payment,
        range: filters.range,
        sort: filters.sort,
      },
    ].slice(-5);
    localStorage.setItem(savedKey, JSON.stringify(next));
    setSaved(next);
  }
  async function toggleSound() {
    if (sound) {
      localStorage.removeItem("armani.orders.sound");
      setSound(false);
      return;
    }
    try {
      const context = new AudioContext();
      await context.resume();
      await context.close();
      localStorage.setItem("armani.orders.sound", "on");
      setSound(true);
    } catch {
      setError("مرورگر اجازه پخش صدا نداد.");
    }
  }
  return (
    <main className={styles.page} dir="rtl">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>مدیریت سفارش‌ها</p>
          <h1>سفارش‌ها</h1>
          <p>پیگیری سفارش و پرداخت به‌صورت جداگانه</p>
        </div>
        <button type="button" onClick={() => void reload()}>
          به‌روزرسانی
        </button>
      </header>
      <StatusMessage
        kind={stale ? "stale" : connection === "offline" ? "offline" : "info"}
        title={
          connection === "online"
            ? "اتصال زنده برقرار است"
            : connection === "connecting"
              ? "در حال اتصال زنده…"
              : "ارتباط زنده قطع است"
        }
      >
        {stale
          ? "آخرین دادهٔ دریافت‌شده نمایش داده می‌شود؛ برای تصمیم عملیاتی، ابتدا به‌روزرسانی کنید."
          : connection === "offline"
            ? "تلاش مجدد خودکار انجام می‌شود."
            : undefined}
      </StatusMessage>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className={styles.counters} aria-label="آمار وضعیت سفارش">
        <h2>وضعیت سفارش</h2>
        <div>
          {(Object.entries(list.counts.fulfillment) as [OrderRow["status"], number][]).map(
            ([key, value]) => (
              <button key={key} type="button" onClick={() => submit({ ...filters, status: key })}>
                <span>{statusNames[key]}</span>
                <strong>{new Intl.NumberFormat("fa-IR").format(value)}</strong>
              </button>
            ),
          )}
        </div>
      </section>
      <section className={styles.counters} aria-label="آمار پرداخت">
        <h2>وضعیت پرداخت</h2>
        <div>
          {(Object.entries(list.counts.payment) as [OrderRow["paymentStatus"], number][]).map(
            ([key, value]) => (
              <button key={key} type="button" onClick={() => submit({ ...filters, payment: key })}>
                <span>{paymentNames[key]}</span>
                <strong>{new Intl.NumberFormat("fa-IR").format(value)}</strong>
              </button>
            ),
          )}
        </div>
      </section>
      <section className={styles.toolbar} aria-label="فیلتر سفارش‌ها">
        <div className={styles.quick}>
          <button
            type="button"
            onClick={() =>
              submit({ ...filters, q: "", status: "NEW", payment: "paid", range: "all" })
            }
          >
            جدید و پرداخت‌شده
          </button>
          <button
            type="button"
            onClick={() =>
              submit({ ...filters, q: "", status: "PREPARING", payment: "all", range: "all" })
            }
          >
            در حال آماده‌سازی
          </button>
          <button
            type="button"
            onClick={() =>
              submit({ ...filters, q: "", status: "READY", payment: "all", range: "all" })
            }
          >
            آماده تحویل
          </button>
          <button
            type="button"
            onClick={() =>
              submit({ ...filters, q: "", status: "all", payment: "all", range: "today" })
            }
          >
            امروز
          </button>
          {saved.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => submit({ ...filters, ...item, q: "" })}
            >
              {item.name}
            </button>
          ))}
          <button type="button" onClick={saveFilter}>
            ذخیره فیلتر
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
          className={styles.filters}
        >
          <label>
            جست‌وجوی کد/موبایل
            <input
              value={draft.q}
              maxLength={80}
              onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            />
          </label>
          <label>
            سفارش
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as OrderFilters["status"] })
              }
            >
              <option value="all">همه</option>
              {Object.entries(statusNames).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            پرداخت
            <select
              value={draft.payment}
              onChange={(event) =>
                setDraft({ ...draft, payment: event.target.value as OrderFilters["payment"] })
              }
            >
              <option value="all">همه</option>
              {Object.entries(paymentNames).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            بازه
            <select
              value={draft.range}
              onChange={(event) =>
                setDraft({ ...draft, range: event.target.value as OrderFilters["range"] })
              }
            >
              <option value="all">همه</option>
              <option value="today">امروز</option>
              <option value="7d">۷ روز</option>
              <option value="30d">۳۰ روز</option>
            </select>
          </label>
          <label>
            ترتیب
            <select
              value={draft.sort}
              onChange={(event) =>
                setDraft({ ...draft, sort: event.target.value as OrderFilters["sort"] })
              }
            >
              <option value="newest">جدیدترین</option>
              <option value="oldest">قدیمی‌ترین</option>
              <option value="amount-high">بیشترین مبلغ</option>
              <option value="amount-low">کمترین مبلغ</option>
            </select>
          </label>
          <button type="submit" className={styles.primary}>
            اعمال فیلتر
          </button>
        </form>
      </section>
      <section className={styles.results} aria-label="فهرست سفارش‌ها">
        <div className={styles.resultHeader}>
          <h2>
            فهرست سفارش‌ها <small>({new Intl.NumberFormat("fa-IR").format(list.total)})</small>
          </h2>
          <button type="button" aria-pressed={sound} onClick={() => void toggleSound()}>
            {sound ? "خاموش‌کردن صدای سفارش" : "فعال‌کردن صدای سفارش"}
          </button>
        </div>
        {canManage && selected.length > 0 && (
          <div className={styles.batch}>
            <span>{selected.length} سفارش انتخاب‌شده</span>
            <button
              type="button"
              disabled={!batchTarget || busy || stale}
              onClick={() => batchTarget && void transition(chosen, batchTarget)}
            >
              {batchTarget ? `تغییر به ${statusNames[batchTarget]}` : "انتقال گروهی نامعتبر"}
            </button>
            <button type="button" onClick={() => setSelected([])}>
              لغو انتخاب
            </button>
          </div>
        )}
        {list.items.length === 0 ? (
          <EmptyState
            variant={
              filters.q ||
              filters.status !== "all" ||
              filters.payment !== "all" ||
              filters.range !== "all"
                ? "filter-empty"
                : "first-use"
            }
            title={
              filters.q ||
              filters.status !== "all" ||
              filters.payment !== "all" ||
              filters.range !== "all"
                ? "سفارشی با این فیلترها پیدا نشد"
                : "هنوز سفارشی ثبت نشده است"
            }
            description={
              filters.q ||
              filters.status !== "all" ||
              filters.payment !== "all" ||
              filters.range !== "all"
                ? "فیلترها را پاک کنید یا عبارت دیگری را جست‌وجو کنید."
                : "پس از نخستین پرداخت موفق، سفارش در این بخش نمایش داده می‌شود."
            }
            action={
              filters.q ||
              filters.status !== "all" ||
              filters.payment !== "all" ||
              filters.range !== "all" ? (
                <button
                  type="button"
                  onClick={() =>
                    submit({
                      ...filters,
                      q: "",
                      status: "all",
                      payment: "all",
                      range: "all",
                      page: 1,
                    })
                  }
                >
                  پاک‌کردن فیلترها
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    {canManage && (
                      <th>
                        <input
                          type="checkbox"
                          aria-label="انتخاب سفارش‌های این صفحه"
                          checked={selected.length === list.items.length}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked ? list.items.map((item) => item.id) : [],
                            )
                          }
                        />
                      </th>
                    )}
                    <th>کد سفارش</th>
                    <th>مشتری</th>
                    <th>اقلام</th>
                    <th>مبلغ</th>
                    <th>سفارش</th>
                    <th>پرداخت</th>
                    <th>زمان</th>
                    <th>اقدام</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((row) => (
                    <tr key={row.id}>
                      {canManage && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`انتخاب ${row.code}`}
                            checked={selected.includes(row.id)}
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? [...selected, row.id]
                                  : selected.filter((id) => id !== row.id),
                              )
                            }
                          />
                        </td>
                      )}
                      <td dir="ltr">
                        <Link href={`/dashboard/orders/${row.id}`}>{row.code}</Link>
                      </td>
                      <td>
                        {row.customerName}
                        <small dir="ltr">{row.customerPhone}</small>
                      </td>
                      <td>{row.summary}</td>
                      <td>{money(row.totalToman)}</td>
                      <td>
                        <span className={styles.pill}>{statusNames[row.status]}</span>
                      </td>
                      <td>
                        <span className={styles.pill}>{paymentNames[row.paymentStatus]}</span>
                      </td>
                      <td>{date(row.placedAt)}</td>
                      <td>
                        {canManage && nextBatchStatus([row]) && (
                          <button
                            type="button"
                            disabled={busy || stale}
                            onClick={() => void transition([row], nextBatchStatus([row])!)}
                          >
                            مرحله بعد
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.cards}>
              {list.items.map((row) => (
                <article key={row.id} className={styles.card}>
                  <div>
                    <strong dir="ltr">
                      <Link href={`/dashboard/orders/${row.id}`}>{row.code}</Link>
                    </strong>
                    {canManage && (
                      <input
                        type="checkbox"
                        aria-label={`انتخاب ${row.code}`}
                        checked={selected.includes(row.id)}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...selected, row.id]
                              : selected.filter((id) => id !== row.id),
                          )
                        }
                      />
                    )}
                  </div>
                  <p>
                    {row.customerName} · {date(row.placedAt)}
                  </p>
                  <p>{row.summary}</p>
                  <strong>{money(row.totalToman)}</strong>
                  <p>
                    سفارش: {statusNames[row.status]} · پرداخت: {paymentNames[row.paymentStatus]}
                  </p>
                  {canManage && nextBatchStatus([row]) && (
                    <button
                      type="button"
                      disabled={busy || stale}
                      onClick={() => void transition([row], nextBatchStatus([row])!)}
                    >
                      مرحله بعد
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        <nav className={styles.pagination} aria-label="صفحه‌بندی سفارش‌ها">
          <RtlPagination
            page={filters.page}
            count={Math.ceil(list.total / 20)}
            onChange={(page) => router.push(pageUrl({ ...filters, page }))}
            label="صفحه‌بندی سفارش‌ها"
          />
        </nav>
      </section>
    </main>
  );
}
