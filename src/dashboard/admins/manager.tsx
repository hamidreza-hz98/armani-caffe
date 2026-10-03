"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AdminDetails } from "@/modules/admins";

import { type AdminList, adminList, adminRequest, AdminRequestError } from "./api";
import styles from "./manager.module.css";
import { AdminPasswordDialog } from "./password-dialog";
import { AdminDialog } from "./person-dialog";
import type { AdminPageFilters } from "./server";

function query(filters: AdminPageFilters) {
  const value = new URLSearchParams({ page: String(filters.page), limit: "20" });
  if (filters.q) value.set("q", filters.q);
  if (filters.role !== "all") value.set("role", filters.role);
  if (filters.status !== "all") value.set("status", filters.status);
  return value;
}
function href(filters: AdminPageFilters, page: number) {
  const value = query({ ...filters, page });
  value.delete("limit");
  return `/dashboard/admins?${value}`;
}
function shortDate(date: string | null) {
  return date
    ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(date))
    : "—";
}

export function AdminManager({
  initial,
  filters,
  actorId,
}: {
  initial: AdminList;
  filters: AdminPageFilters;
  actorId: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<AdminDetails | "new" | null>(null);
  const [resetting, setResetting] = useState<AdminDetails | null>(null);
  const [confirming, setConfirming] = useState<{
    admin: AdminDetails;
    action: "disable" | "enable" | "delete";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lastOwner = (admin: AdminDetails) =>
    admin.role === "OWNER" && admin.status === "active" && list.stats.activeOwners <= 1;
  const protectedAdmin = (admin: AdminDetails) => admin.id === actorId || lastOwner(admin);
  async function reload() {
    try {
      setList(await adminList(query(filters)));
      router.refresh();
    } catch {
      setError("تغییر ذخیره شد، اما فهرست تازه نشد. صفحه را بازخوانی کنید.");
    }
  }
  async function act() {
    if (!confirming || busy) return;
    const { admin, action } = confirming;
    if (protectedAdmin(admin) && action !== "enable") return;
    setBusy(true);
    setError("");
    try {
      if (action === "delete")
        await adminRequest(`/api/admins/${admin.id}`, "DELETE", { revision: admin.revision });
      else
        await adminRequest(`/api/admins/${admin.id}`, "PATCH", {
          username: admin.username,
          displayName: admin.displayName,
          phone: admin.phone,
          role: admin.role,
          status: action === "enable" ? "active" : "disabled",
          revision: admin.revision,
        });
      setConfirming(null);
      setMessage(
        action === "delete"
          ? "حساب مدیر حذف شد."
          : action === "enable"
            ? "حساب مدیر فعال شد."
            : "حساب مدیر غیرفعال شد و نشست‌های آن باطل شدند.",
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof AdminRequestError ? cause.message : "درخواست انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  const pages = Math.max(1, Math.ceil(list.total / 20));
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>مدیریت دسترسی</p>
          <h1>مدیران و نقش‌ها</h1>
          <p>فقط مالک می‌تواند حساب‌های مدیریتی را ایجاد یا تغییر دهد.</p>
        </div>
        <button className={styles.primary} onClick={() => setEditing("new")}>
          افزودن مدیر
        </button>
      </header>
      <section className={styles.stats} aria-label="آمار مدیران">
        <div>
          <strong>{list.stats.total.toLocaleString("fa-IR")}</strong>
          <span>کل مدیران</span>
        </div>
        <div>
          <strong>{list.stats.activeOwners.toLocaleString("fa-IR")}</strong>
          <span>مالک فعال</span>
        </div>
        <div>
          <strong>{list.stats.activeCashiers.toLocaleString("fa-IR")}</strong>
          <span>صندوقدار فعال</span>
        </div>
        <div>
          <strong>{list.stats.disabled.toLocaleString("fa-IR")}</strong>
          <span>غیرفعال</span>
        </div>
      </section>
      <form className={styles.filters} method="get">
        <label>
          جستجو
          <input
            name="q"
            defaultValue={filters.q}
            maxLength={80}
            placeholder="نام، نام کاربری یا موبایل"
          />
        </label>
        <label>
          نقش
          <select name="role" defaultValue={filters.role}>
            <option value="all">همه نقش‌ها</option>
            <option value="OWNER">مالک</option>
            <option value="CASHIER">صندوقدار</option>
          </select>
        </label>
        <label>
          وضعیت
          <select name="status" defaultValue={filters.status}>
            <option value="all">همه وضعیت‌ها</option>
            <option value="active">فعال</option>
            <option value="disabled">غیرفعال</option>
          </select>
        </label>
        <button className={styles.secondary} type="submit">
          اعمال فیلتر
        </button>
      </form>
      {message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}{" "}
          <button type="button" onClick={() => void reload()}>
            تازه‌سازی
          </button>
        </p>
      )}
      <section aria-label="فهرست مدیران" className={styles.list}>
        {list.items.length === 0 ? (
          <div className={styles.empty}>
            <h2>مدیری پیدا نشد</h2>
            <p>فیلترها را تغییر دهید یا یک مدیر تازه اضافه کنید.</p>
          </div>
        ) : (
          list.items.map((admin) => (
            <article className={styles.card} key={admin.id}>
              <div className={styles.identity}>
                <div className={styles.avatar} aria-hidden="true">
                  {admin.displayName.slice(0, 1)}
                </div>
                <div>
                  <h2>
                    {admin.displayName}
                    {admin.id === actorId && <small> (شما)</small>}
                  </h2>
                  <p dir="ltr">@{admin.username}</p>
                </div>
              </div>
              <div className={styles.detail}>
                <span>{admin.role === "OWNER" ? "مالک" : "صندوقدار"}</span>
                <span className={admin.status === "active" ? styles.active : styles.inactive}>
                  {admin.status === "active" ? "فعال" : "غیرفعال"}
                </span>
                <span dir="ltr">{admin.phone}</span>
                <span>آخرین ورود: {shortDate(admin.lastLoginAt)}</span>
              </div>
              <div className={styles.actions}>
                <button onClick={() => setEditing(admin)}>ویرایش</button>
                <button
                  onClick={() => setResetting(admin)}
                  disabled={admin.id === actorId}
                  title={admin.id === actorId ? "رمز خود را از این بخش تغییر ندهید" : undefined}
                >
                  بازنشانی رمز
                </button>
                <button
                  onClick={() =>
                    setConfirming({
                      admin,
                      action: admin.status === "active" ? "disable" : "enable",
                    })
                  }
                  disabled={admin.status === "active" && protectedAdmin(admin)}
                  title={
                    admin.status === "active" && protectedAdmin(admin)
                      ? "حساب خود یا آخرین مالک فعال را نمی‌توان غیرفعال کرد"
                      : undefined
                  }
                >
                  {admin.status === "active" ? "غیرفعال‌سازی" : "فعال‌سازی"}
                </button>
                <button
                  className={styles.danger}
                  onClick={() => setConfirming({ admin, action: "delete" })}
                  disabled={protectedAdmin(admin)}
                  title={
                    protectedAdmin(admin)
                      ? "حساب خود یا آخرین مالک فعال را نمی‌توان حذف کرد"
                      : undefined
                  }
                >
                  حذف
                </button>
              </div>
            </article>
          ))
        )}
      </section>
      <nav className={styles.pagination} aria-label="صفحه‌بندی">
        <span>
          صفحه {filters.page.toLocaleString("fa-IR")} از {pages.toLocaleString("fa-IR")}
        </span>
        {filters.page > 1 && <Link href={href(filters, filters.page - 1)}>قبلی</Link>}
        {filters.page < pages && <Link href={href(filters, filters.page + 1)}>بعدی</Link>}
      </nav>
      {editing && (
        <AdminDialog
          admin={editing === "new" ? null : editing}
          actorId={actorId}
          activeOwners={list.stats.activeOwners}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            setMessage(text);
            setError("");
            await reload();
          }}
        />
      )}
      {resetting && (
        <AdminPasswordDialog
          admin={resetting}
          onClose={() => setResetting(null)}
          onSaved={async () => {
            setResetting(null);
            setMessage("رمز تازه ثبت و نشست‌های قبلی باطل شدند.");
            await reload();
          }}
        />
      )}
      {confirming && (
        <dialog
          className={styles.dialog}
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setConfirming(null);
          }}
          aria-labelledby="confirm-title"
        >
          <h2 id="confirm-title">
            {confirming.action === "delete"
              ? "حذف مدیر"
              : confirming.action === "disable"
                ? "غیرفعال‌سازی مدیر"
                : "فعال‌سازی مدیر"}
          </h2>
          <p>
            {confirming.admin.displayName} ({confirming.admin.username})
          </p>
          <p>
            {confirming.action === "delete"
              ? "این حساب از فهرست حذف و دسترسی‌اش قطع می‌شود. این کار قابل بازگشت از این صفحه نیست."
              : confirming.action === "disable"
                ? "دسترسی و نشست‌های این مدیر قطع می‌شوند."
                : "دسترسی این مدیر دوباره برقرار می‌شود."}
          </p>
          <div className={styles.dialogActions}>
            <button disabled={busy} onClick={() => setConfirming(null)}>
              انصراف
            </button>
            <button
              className={confirming.action === "enable" ? styles.primary : styles.danger}
              disabled={busy}
              onClick={() => void act()}
            >
              {busy ? "در حال انجام…" : "تأیید"}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
