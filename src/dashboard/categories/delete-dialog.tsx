"use client";

import { useEffect, useRef } from "react";

import type { Category } from "@/modules/catalog/categories";

import styles from "./categories.module.css";

export function CategoryDeleteDialog({
  category,
  productCount,
  busy,
  error,
  onClose,
  onDelete,
}: {
  category: Category;
  productCount: number;
  busy: boolean;
  error: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="category-delete-title"
      aria-describedby="category-delete-description"
      className={styles.deleteDialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="category-delete-title">حذف «{category.name}»؟</h2>
      <p id="category-delete-description">
        این دسته‌بندی از مدیریت و منوی عمومی حذف می‌شود.{" "}
        {productCount
          ? `${productCount.toLocaleString("fa-IR")} محصول به آن وابسته است؛ ابتدا محصولات را به دسته دیگری منتقل کنید.`
          : "در حال حاضر محصول وابسته‌ای برای آن ثبت نشده است."}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button ref={cancel} type="button" disabled={busy} onClick={onClose}>
          انصراف
        </button>
        <button
          type="button"
          className={styles.danger}
          disabled={busy || productCount > 0}
          onClick={onDelete}
        >
          حذف دسته‌بندی
        </button>
      </div>
    </dialog>
  );
}
