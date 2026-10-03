"use client";

import { useEffect, useRef, useState } from "react";

import type { AdminDetails } from "@/modules/admins";

import { adminRequest, AdminRequestError } from "./api";
import styles from "./manager.module.css";

export function AdminPasswordDialog({
  admin,
  onClose,
  onSaved,
}: {
  admin: AdminDetails;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.current?.reportValidity() || busy) return;
    const password = String(new FormData(form.current).get("password") ?? "");
    if (Array.from(password).length < 15) {
      setError("رمز باید دست‌کم ۱۵ نویسه باشد.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminRequest(`/api/admins/${admin.id}/password`, "POST", { password });
      form.current?.reset();
      onSaved();
    } catch (cause) {
      setError(cause instanceof AdminRequestError ? cause.message : "بازنشانی انجام نشد.");
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
      aria-labelledby="reset-title"
    >
      <h2 id="reset-title">بازنشانی رمز {admin.displayName}</h2>
      <p>پس از ذخیره، نشست‌های قبلی این مدیر باطل می‌شوند. رمز قبلی نمایش داده نمی‌شود.</p>
      <form ref={form} className={styles.editor} onSubmit={(event) => void submit(event)}>
        <label>
          رمز تازه
          <input
            name="password"
            type="password"
            required
            minLength={15}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button disabled={busy} type="button" onClick={onClose}>
            انصراف
          </button>
          <button disabled={busy} className={styles.primary} type="submit">
            {busy ? "در حال ذخیره…" : "ثبت رمز تازه"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
