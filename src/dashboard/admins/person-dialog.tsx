"use client";

import { useEffect, useRef, useState } from "react";

import type { AdminDetails } from "@/modules/admins";

import { adminRequest, AdminRequestError } from "./api";
import styles from "./manager.module.css";

export function AdminDialog({
  admin,
  actorId,
  activeOwners,
  onClose,
  onSaved,
}: {
  admin: AdminDetails | null;
  actorId: string;
  activeOwners: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const self = admin?.id === actorId;
  const lastOwner = admin?.role === "OWNER" && admin.status === "active" && activeOwners <= 1;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  function close() {
    if (!busy) onClose();
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.current?.reportValidity() || busy) return;
    const values = new FormData(form.current);
    const username = String(values.get("username") ?? "")
      .trim()
      .toLowerCase();
    const displayName = String(values.get("displayName") ?? "").trim();
    const phone = String(values.get("phone") ?? "").trim();
    const role = self || lastOwner ? admin?.role : values.get("role");
    const status = self || lastOwner ? admin?.status : values.get("status");
    if (!/^[a-z][a-z0-9._-]{2,39}$/.test(username)) {
      setError("نام کاربری باید با حرف لاتین آغاز شود و ۳ تا ۴۰ نویسه باشد.");
      return;
    }
    if (!displayName || displayName.length > 120 || /[<>\u0000-\u001f\u007f]/u.test(displayName)) {
      setError("نام نمایشی معتبر نیست.");
      return;
    }
    if (role !== "OWNER" && role !== "CASHIER") {
      setError("نقش معتبر نیست.");
      return;
    }
    if (lastOwner && (role !== "OWNER" || status !== "active")) {
      setError("آخرین مالک فعال باید حفظ شود.");
      return;
    }
    const input = {
      username: self && admin ? admin.username : username,
      displayName,
      phone,
      role,
      ...(admin
        ? { status, revision: admin.revision }
        : { password: String(values.get("password") ?? "") }),
    };
    setBusy(true);
    setError("");
    try {
      await adminRequest(
        admin ? `/api/admins/${admin.id}` : "/api/admins",
        admin ? "PATCH" : "POST",
        input,
      );
      form.current?.reset();
      onSaved(admin ? "اطلاعات مدیر ذخیره شد." : "مدیر تازه ایجاد شد.");
    } catch (cause) {
      setError(cause instanceof AdminRequestError ? cause.message : "ذخیره انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      aria-labelledby="editor-title"
    >
      <h2 id="editor-title">{admin ? "ویرایش مدیر" : "افزودن مدیر"}</h2>
      <p>رمز فعلی و هش رمز هرگز نمایش داده نمی‌شوند.</p>
      <form ref={form} onSubmit={(event) => void submit(event)} className={styles.editor}>
        <label>
          نام نمایشی
          <input
            name="displayName"
            required
            maxLength={120}
            defaultValue={admin?.displayName ?? ""}
            autoComplete="off"
          />
        </label>
        <label>
          نام کاربری لاتین
          <input
            name="username"
            dir="ltr"
            required
            minLength={3}
            maxLength={40}
            defaultValue={admin?.username ?? ""}
            readOnly={self}
            autoComplete="off"
          />
        </label>
        <label>
          موبایل
          <input
            name="phone"
            dir="ltr"
            required
            defaultValue={admin?.phone ?? ""}
            inputMode="tel"
            autoComplete="off"
          />
        </label>
        <label>
          نقش
          <select name="role" defaultValue={admin?.role ?? "CASHIER"} disabled={self || lastOwner}>
            <option value="CASHIER">
              صندوقدار — سفارش‌ها، فاکتورها و درخواست موجودی؛ بدون مدیریت مدیران یا تنظیمات
            </option>
            <option value="OWNER">مالک — دسترسی کامل به مدیریت، تنظیمات و تأییدها</option>
          </select>
        </label>
        {admin && (
          <label>
            وضعیت
            <select name="status" defaultValue={admin.status} disabled={self || lastOwner}>
              <option value="active">فعال</option>
              <option value="disabled">غیرفعال</option>
            </select>
          </label>
        )}
        {!admin && (
          <label>
            رمز اولیه
            <input
              name="password"
              type="password"
              required
              minLength={15}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
        )}
        {(self || lastOwner) && (
          <p className={styles.warning}>
            {self
              ? "برای امنیت، نقش، وضعیت و نام کاربری حساب خودتان از اینجا تغییر نمی‌کند."
              : "آخرین مالک فعال را نمی‌توان غیرفعال یا تنزل نقش داد."}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" disabled={busy} onClick={close}>
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
