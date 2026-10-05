"use client";

import { useRef, useState } from "react";

import { inventoryRequest } from "./api";
import { useInventoryDialogFocus } from "./dialog-focus";
import styles from "./inventory.module.css";
import type { InventoryItem, StockUnit } from "./model";
import { unitLabels } from "./model";

export function ItemEditor({
  item,
  onClose,
  onSaved,
}: {
  item: InventoryItem | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState<StockUnit>(item?.unit ?? "gram");
  const [reorderLevel, setReorderLevel] = useState(item?.reorderLevel ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  useInventoryDialogFocus(dialogRef, true, onClose);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (item) {
        await inventoryRequest(`/api/inventory/${item.id}`, "PATCH", {
          revision: item.revision,
          name: name.trim(),
          reorderLevel,
        });
      } else {
        await inventoryRequest("/api/inventory", "POST", { name: name.trim(), unit, reorderLevel });
      }
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ذخیره انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={styles.modalBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-editor-title"
      >
        <h2 id="stock-editor-title">{item ? "ویرایش قلم موجودی" : "افزودن قلم موجودی"}</h2>
        <form onSubmit={submit}>
          <label>
            نام قلم
            <input
              autoFocus
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            واحد پایه
            <select
              disabled={!!item}
              value={unit}
              onChange={(event) => setUnit(event.target.value as StockUnit)}
            >
              {(Object.keys(unitLabels) as StockUnit[]).map((key) => (
                <option key={key} value={key}>
                  {unitLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.hint}>
            واحد پایه پس از ایجاد تغییر نمی‌کند. برای خرید، واحد سازگار مانند کیلوگرم یا لیتر نیز
            قابل انتخاب است.
          </p>
          <label>
            حد هشدار
            <input
              required
              type="number"
              min="0"
              step="1"
              value={reorderLevel}
              onChange={(event) => setReorderLevel(Number(event.target.value))}
            />
          </label>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" onClick={onClose} disabled={busy}>
              انصراف
            </button>
            <button className={styles.primary} disabled={busy}>
              {busy ? "در حال ذخیره…" : "ذخیره"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
