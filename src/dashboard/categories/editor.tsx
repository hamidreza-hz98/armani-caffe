"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { MediaPicker } from "@/dashboard/media/picker";
import type { Category } from "@/modules/catalog/categories";
import { useFeedback } from "@/theme/feedback-provider";

import { categoryRequest, CategoryRequestError } from "./api";
import styles from "./categories.module.css";

export function CategoryEditor({
  category,
  productCount,
  onClose,
  onSaved,
}: {
  category: Category | null;
  productCount: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(category?.name ?? "");
  const [status, setStatus] = useState<"draft" | "published">(category?.status ?? "draft");
  const [mediaId, setMediaId] = useState<string | null>(category?.mediaId ?? null);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const feedback = useFeedback();
  const original = {
    name: category?.name ?? "",
    status: category?.status ?? "draft",
    mediaId: category?.mediaId ?? null,
  };
  const dirty =
    name !== original.name || status !== original.status || mediaId !== original.mediaId;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    nameInput.current?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  async function close() {
    if (busy) return;
    if (dirty) {
      const element = dialog.current;
      element?.close();
      const discard = await feedback.confirm({
        title: "کنارگذاشتن تغییرات؟",
        description: "تغییرات این دسته‌بندی ذخیره نشده‌اند.",
        confirmLabel: "خروج بدون ذخیره",
        dangerous: true,
      });
      if (!discard) {
        element?.showModal();
        return;
      }
    }
    onClose();
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = name.trim().normalize("NFC");
    if (!normalized || normalized.length > 120 || /[<>\u0000-\u001f\u007f]/u.test(normalized)) {
      setError("نام دسته‌بندی باید بین ۱ تا ۱۲۰ نویسه و بدون نشانه‌های نامعتبر باشد.");
      nameInput.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (category)
        await categoryRequest(`/api/categories/${category.id}`, "PATCH", {
          revision: category.revision,
          name: normalized,
          status,
          mediaId,
        });
      else await categoryRequest("/api/categories", "POST", { name: normalized, status, mediaId });
      onSaved(
        category
          ? "دسته‌بندی ویرایش شد. منوی عمومی نیز تازه شد."
          : "دسته‌بندی ساخته شد. منوی عمومی نیز تازه شد.",
      );
    } catch (cause) {
      setError(cause instanceof CategoryRequestError ? cause.message : "ذخیره انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <dialog
        ref={dialog}
        className={styles.editorDialog}
        aria-labelledby="category-editor-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) void close();
        }}
        onCancel={(event) => {
          event.preventDefault();
          void close();
        }}
      >
        <div className={styles.row}>
          <h2 id="category-editor-title">{category ? "ویرایش دسته‌بندی" : "دسته‌بندی جدید"}</h2>
          <button type="button" onClick={() => void close()} aria-label="بستن فرم">
            ×
          </button>
        </div>
        <form onSubmit={save} className={styles.editorForm}>
          <label htmlFor="category-name">نام دسته‌بندی</label>
          <input
            ref={nameInput}
            id="category-name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "category-form-error" : undefined}
          />
          <p className={styles.hint}>نشانی دسته‌بندی توسط سیستم ساخته می‌شود و قابل ویرایش نیست.</p>
          <fieldset>
            <legend>وضعیت نمایش</legend>
            <label>
              <input
                type="radio"
                name="status"
                checked={status === "draft"}
                onChange={() => setStatus("draft")}
              />{" "}
              غیرفعال / پیش‌نویس
            </label>
            <label>
              <input
                type="radio"
                name="status"
                checked={status === "published"}
                onChange={() => setStatus("published")}
              />{" "}
              فعال در منو
            </label>
          </fieldset>
          {category && status === "draft" && category.status === "published" && (
            <p className={styles.warning}>
              غیرفعال‌کردن این دسته، آن را همراه محصولاتش از منوی عمومی پنهان می‌کند.{" "}
              {productCount ? `${productCount.toLocaleString("fa-IR")} محصول وابسته دارد.` : ""}
            </p>
          )}
          <div className={styles.mediaField}>
            <span>تصویر دسته‌بندی</span>
            {mediaId ? (
              <div className={styles.row}>
                <Image
                  src={`/api/media/${mediaId}/file?variant=small`}
                  alt="پیش‌نمایش تصویر دسته‌بندی"
                  width={64}
                  height={64}
                  unoptimized
                />
                <bdi>{mediaId}</bdi>
                <button type="button" onClick={() => setMediaId(null)}>
                  حذف تصویر
                </button>
              </div>
            ) : (
              <p>تصویری انتخاب نشده است.</p>
            )}
            <button type="button" className={styles.secondary} onClick={() => setPicker(true)}>
              انتخاب از کتابخانه رسانه
            </button>
          </div>
          {error && (
            <p id="category-form-error" role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" onClick={close} disabled={busy}>
              انصراف
            </button>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? "در حال ذخیره…" : "ذخیره دسته‌بندی"}
            </button>
          </div>
        </form>
      </dialog>
      {picker && (
        <MediaPicker
          onSelect={(id) => {
            setMediaId(id);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </>
  );
}
