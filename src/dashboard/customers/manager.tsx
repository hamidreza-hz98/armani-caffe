"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { gregorianToJalali, jalaliToGregorian } from "@/shared/jalali-date";

import styles from "./manager.module.css";
import type { CustomerFilters, CustomerList, CustomerRow } from "./server";

type Detail = {
  customer: CustomerRow;
  metrics: { orderCount: number; spentToman: number };
  recentOrders: {
    id: string;
    code: string;
    status: string;
    totalToman: number;
    placedAt: string;
  }[];
};
type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      cache: "no-store",
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("ارتباط برقرار نشد. دوباره تلاش کنید.");
  }
  let result: Envelope<T>;
  try {
    result = (await response.json()) as Envelope<T>;
  } catch {
    throw new Error("پاسخ سرویس معتبر نیست.");
  }
  if (!response.ok || !result.ok) {
    const code = result.ok ? "UNKNOWN" : result.error.code;
    throw new Error(
      code === "CONFLICT"
        ? "این مشتری تغییر کرده یا شماره موبایل تکراری است. فهرست را تازه کنید."
        : code === "VALIDATION"
          ? "اطلاعات مشتری معتبر نیست."
          : code === "FORBIDDEN"
            ? "اجازه انجام این کار را ندارید."
            : "درخواست انجام نشد. دوباره تلاش کنید.",
    );
  }
  return result.value;
}
function params(filters: CustomerFilters) {
  const value = new URLSearchParams({ page: String(filters.page) });
  if (filters.q) value.set("q", filters.q);
  if (filters.status !== "all") value.set("status", filters.status);
  return value;
}
function phone(value: string | null) {
  if (!value) return "—";
  const national = value.startsWith("+98") ? `0${value.slice(3)}` : value;
  return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
}
function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value))
    : "—";
}

export function CustomerManager({
  initial,
  filters,
  editable,
}: {
  initial: CustomerList;
  filters: CustomerFilters;
  editable: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<CustomerRow | "new" | null>(null);
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [deleting, setDeleting] = useState<CustomerRow | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function reload() {
    try {
      setList(await request<CustomerList>(`/api/admin/customers?${params(filters)}`));
      router.refresh();
    } catch {
      setError("تغییر ذخیره شد، اما فهرست تازه نشد. صفحه را بازخوانی کنید.");
    }
  }
  async function anonymize() {
    if (!deleting || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/admin/customers/${deleting.id}`, "DELETE", {
        revision: deleting.revision,
      });
      setDeleting(null);
      setSelected(null);
      setMessage("پروفایل مشتری ناشناس شد؛ سوابق مالی حفظ شدند.");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "عملیات انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  const pages = Math.max(1, Math.ceil(list.total / 20));
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ارتباط با مشتریان</p>
          <h1>مشتریان</h1>
          <p>پروفایل‌ها و تاریخچه خرید، با دسترسی متناسب با نقش شما</p>
        </div>
        {editable && (
          <button className={styles.primary} onClick={() => setEditing("new")}>
            افزودن مشتری
          </button>
        )}
      </header>
      <section className={styles.stats} aria-label="آمار مشتریان">
        <div>
          <strong>{list.stats.total.toLocaleString("fa-IR")}</strong>
          <span>کل مشتریان</span>
        </div>
        <div>
          <strong>{list.stats.active.toLocaleString("fa-IR")}</strong>
          <span>فعال</span>
        </div>
        <div>
          <strong>{list.stats.blocked.toLocaleString("fa-IR")}</strong>
          <span>مسدود</span>
        </div>
        <div>
          <strong>{list.stats.anonymized.toLocaleString("fa-IR")}</strong>
          <span>ناشناس‌شده</span>
        </div>
      </section>
      <form className={styles.filters} method="get">
        <label>
          جستجو
          <input
            name="q"
            maxLength={80}
            defaultValue={filters.q}
            placeholder="نام یا شماره موبایل"
          />
        </label>
        <label>
          وضعیت
          <select name="status" defaultValue={filters.status}>
            <option value="all">همه</option>
            <option value="active">فعال</option>
            <option value="blocked">مسدود</option>
            <option value="anonymized">ناشناس‌شده</option>
          </select>
        </label>
        <button type="submit" className={styles.secondary}>
          اعمال فیلتر
        </button>
      </form>
      {message && (
        <p role="status" className={styles.success}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error} <button onClick={() => void reload()}>تازه‌سازی</button>
        </p>
      )}
      <section className={styles.list} aria-label="فهرست مشتریان">
        {list.items.length === 0 ? (
          <div className={styles.empty}>
            <h2>مشتری پیدا نشد</h2>
            <p>فیلترها را تغییر دهید{editable ? " یا مشتری تازه‌ای اضافه کنید" : ""}.</p>
          </div>
        ) : (
          list.items.map((customer) => (
            <article className={styles.card} key={customer.id}>
              <div>
                <h2>{customer.displayName ?? "مشتری بدون نام"}</h2>
                <p dir="ltr">{phone(customer.phone)}</p>
              </div>
              <div className={styles.meta}>
                <span className={customer.status === "active" ? styles.active : styles.inactive}>
                  {customer.status === "active"
                    ? "فعال"
                    : customer.status === "blocked"
                      ? "مسدود"
                      : "ناشناس‌شده"}
                </span>
                <span>عضویت: {date(customer.createdAt)}</span>
                <span>آخرین سفارش: {date(customer.lastOrderAt)}</span>
              </div>
              <div className={styles.actions}>
                <button onClick={() => setSelected(customer)}>جزئیات</button>
                {editable && customer.status !== "anonymized" && (
                  <>
                    <button onClick={() => setEditing(customer)}>ویرایش</button>
                    <button className={styles.danger} onClick={() => setDeleting(customer)}>
                      ناشناس‌سازی
                    </button>
                  </>
                )}
              </div>
            </article>
          ))
        )}
      </section>
      <nav aria-label="صفحه‌بندی" className={styles.pagination}>
        <span>
          صفحه {filters.page.toLocaleString("fa-IR")} از {pages.toLocaleString("fa-IR")}
        </span>
        {filters.page > 1 && (
          <Link href={`/dashboard/customers?${params({ ...filters, page: filters.page - 1 })}`}>
            قبلی
          </Link>
        )}
        {filters.page < pages && (
          <Link href={`/dashboard/customers?${params({ ...filters, page: filters.page + 1 })}`}>
            بعدی
          </Link>
        )}
      </nav>
      {editing && (
        <CustomerEditor
          customer={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            setMessage(text);
            setError("");
            await reload();
          }}
        />
      )}
      {selected && <CustomerDetails customer={selected} onClose={() => setSelected(null)} />}
      {deleting && (
        <dialog
          className={styles.dialog}
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) setDeleting(null);
          }}
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setDeleting(null);
          }}
          aria-labelledby="delete-title"
        >
          <h2 id="delete-title">ناشناس‌سازی مشتری</h2>
          <p>
            نام، موبایل و تاریخ تولد از پروفایل {deleting.displayName ?? "این مشتری"} برای همیشه حذف
            و دسترسی حساب قطع می‌شود. سوابق مالی و فاکتورها، از جمله اطلاعات ثبت‌شده هنگام خرید،
            بدون تغییر حفظ می‌شوند.
          </p>
          <div className={styles.dialogActions}>
            <button disabled={busy} onClick={() => setDeleting(null)}>
              انصراف
            </button>
            <button disabled={busy} className={styles.danger} onClick={() => void anonymize()}>
              {busy ? "در حال انجام…" : "تأیید ناشناس‌سازی"}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}

function CustomerEditor({
  customer,
  onClose,
  onSaved,
}: {
  customer: CustomerRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.current?.reportValidity() || busy) return;
    const data = new FormData(form.current);
    const rawBirth = String(data.get("birthDate") ?? "").trim();
    let birthDate: string | null = null;
    try {
      birthDate = rawBirth ? jalaliToGregorian(rawBirth) : null;
    } catch {
      setError("تاریخ تولد جلالی معتبر نیست. نمونه: ۱۳۷۵-۰۶-۱۵ با رقم‌های لاتین.");
      return;
    }
    const input = {
      phone: String(data.get("phone") ?? "").trim(),
      displayName: String(data.get("displayName") ?? "").trim(),
      birthDate,
      ...(customer
        ? { status: data.get("status"), revision: customer.revision }
        : { password: String(data.get("password") ?? "") }),
    };
    setBusy(true);
    setError("");
    try {
      await request(
        customer ? `/api/admin/customers/${customer.id}` : "/api/admin/customers",
        customer ? "PATCH" : "POST",
        input,
      );
      form.current?.reset();
      onSaved(customer ? "اطلاعات مشتری ذخیره شد." : "مشتری تازه ایجاد شد.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ذخیره انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      aria-labelledby="edit-title"
    >
      <h2 id="edit-title">{customer ? "ویرایش مشتری" : "افزودن مشتری"}</h2>
      <form ref={form} className={styles.editor} onSubmit={(event) => void submit(event)}>
        <label>
          نام نمایشی
          <input
            name="displayName"
            required
            maxLength={120}
            defaultValue={customer?.displayName ?? ""}
          />
        </label>
        <label>
          شماره موبایل
          <input
            name="phone"
            dir="ltr"
            required
            inputMode="tel"
            defaultValue={customer?.phone ?? ""}
          />
        </label>
        <label>
          تاریخ تولد جلالی (اختیاری)
          <input
            name="birthDate"
            dir="ltr"
            inputMode="numeric"
            placeholder="1375-06-15"
            defaultValue={customer?.birthDate ? gregorianToJalali(customer.birthDate) : ""}
            aria-describedby="birth-help"
          />
        </label>
        <p id="birth-help" className={styles.hint}>
          تاریخ به صورت جلالی وارد و به صورت تاریخ تقویمی UTC نگهداری می‌شود.
        </p>
        {customer ? (
          <label>
            وضعیت
            <select name="status" defaultValue={customer.status}>
              <option value="active">فعال</option>
              <option value="blocked">مسدود</option>
            </select>
          </label>
        ) : (
          <label>
            رمز اولیه
            <input
              type="password"
              name="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" disabled={busy} onClick={onClose}>
            انصراف
          </button>
          <button className={styles.primary} disabled={busy} type="submit">
            {busy ? "در حال ذخیره…" : "ذخیره"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function CustomerDetails({ customer, onClose }: { customer: CustomerRow; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    let live = true;
    void request<Detail>(`/api/admin/customers/${customer.id}`)
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : "جزئیات بارگیری نشد.");
      });
    return () => {
      live = false;
      element?.close();
      previous?.focus();
    };
  }, [customer.id]);
  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles.drawer}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onCancel={onClose}
      aria-labelledby="detail-title"
    >
      <div className={styles.drawerHeader}>
        <h2 id="detail-title">جزئیات {customer.displayName ?? "مشتری"}</h2>
        <button onClick={onClose}>بستن</button>
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : !detail ? (
        <p role="status">در حال بارگیری…</p>
      ) : (
        <>
          <p dir="ltr">{phone(detail.customer.phone)}</p>
          <p>
            تاریخ تولد:{" "}
            {detail.customer.birthDate ? gregorianToJalali(detail.customer.birthDate) : "—"}
          </p>
          <div className={styles.detailMetrics}>
            <div>
              <strong>{detail.metrics.orderCount.toLocaleString("fa-IR")}</strong>
              <span>سفارش پرداخت‌شده</span>
            </div>
            <div>
              <strong>{detail.metrics.spentToman.toLocaleString("fa-IR")}</strong>
              <span>تومان خرید</span>
            </div>
          </div>
          <h3>سفارش‌های اخیر</h3>
          {detail.recentOrders.length ? (
            <ul className={styles.orders}>
              {detail.recentOrders.map((order) => (
                <li key={order.id}>
                  <span>{order.code}</span>
                  <span>{date(order.placedAt)}</span>
                  <strong>{order.totalToman.toLocaleString("fa-IR")} تومان</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>هنوز سفارشی ثبت نشده است.</p>
          )}
        </>
      )}
    </dialog>
  );
}
