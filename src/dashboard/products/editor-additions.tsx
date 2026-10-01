"use client";

import type { Addition } from "./form-types";
import styles from "./products.module.css";

export function AdditionsEditor({
  value,
  onChange,
  onPickMedia,
}: {
  value: Addition[];
  onChange: (value: Addition[]) => void;
  onPickMedia: (index: number) => void;
}) {
  const update = (index: number, field: keyof Addition, next: string | number | boolean | null) =>
    onChange(
      value.map((addition, position) =>
        position === index ? { ...addition, [field]: next } : addition,
      ),
    );
  const move = (index: number, direction: -1 | 1) => {
    const next = [...value];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className={styles.subEditor}>
      {value.map((addition, index) => (
        <div className={styles.additionRow} key={addition.id ?? `new-${index}`}>
          <div className={styles.rowHeading}>
            <strong>افزودنی {index + 1}</strong>
            <div>
              <button
                type="button"
                aria-label={`انتقال افزودنی ${index + 1} به بالا`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`انتقال افزودنی ${index + 1} به پایین`}
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`حذف افزودنی ${index + 1}`}
                onClick={() => onChange(value.filter((_, position) => position !== index))}
              >
                حذف
              </button>
            </div>
          </div>
          <div className={styles.fieldGrid}>
            <label>
              نام{" "}
              <input
                required
                maxLength={120}
                value={addition.name}
                onChange={(event) => update(index, "name", event.target.value)}
              />
            </label>
            <label>
              قیمت (تومان){" "}
              <input
                type="number"
                min="0"
                step="1"
                value={addition.priceToman}
                onChange={(event) => update(index, "priceToman", Number(event.target.value))}
              />
            </label>
          </div>
          <div className={styles.rowHeading}>
            <label className={styles.switchRow}>
              <input
                type="checkbox"
                checked={addition.available}
                onChange={(event) => update(index, "available", event.target.checked)}
              />{" "}
              در دسترس
            </label>
            <button type="button" className={styles.secondary} onClick={() => onPickMedia(index)}>
              {addition.mediaId ? "تغییر تصویر" : "انتخاب تصویر"}
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className={styles.secondary}
        disabled={value.length >= 40}
        onClick={() =>
          onChange([...value, { name: "", priceToman: 0, available: true, mediaId: null }])
        }
      >
        + افزودنی جدید
      </button>
    </div>
  );
}
