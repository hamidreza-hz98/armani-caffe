"use client";

import type { Rule } from "./form-types";
import styles from "./products.module.css";

const unitLabel: Record<string, string> = { gram: "گرم", milliliter: "میلی‌لیتر", piece: "عدد" };
export function RulesEditor({
  value,
  inventory,
  onChange,
}: {
  value: Rule[];
  inventory: readonly { id: string; name: string; unit: "gram" | "milliliter" | "piece" }[];
  onChange: (value: Rule[]) => void;
}) {
  const set = (index: number, next: Rule) =>
    onChange(value.map((rule, position) => (position === index ? next : rule)));
  return (
    <div className={styles.subEditor}>
      {value.map((rule, index) => (
        <div className={styles.ruleRow} key={`${rule.inventoryItemId}-${index}`}>
          <label>
            قلم انبار{" "}
            <select
              required
              value={rule.inventoryItemId}
              onChange={(event) => {
                const item = inventory.find((entry) => entry.id === event.target.value);
                set(index, {
                  inventoryItemId: item?.id ?? "",
                  quantity: rule.quantity,
                  unit: item?.unit ?? "",
                });
              }}
            >
              <option value="">انتخاب کنید</option>
              {inventory.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({unitLabel[item.unit]})
                </option>
              ))}
            </select>
          </label>
          <label>
            مصرف هر واحد{" "}
            <input
              required
              type="number"
              min="1"
              step="1"
              value={rule.quantity}
              onChange={(event) => set(index, { ...rule, quantity: event.target.value })}
            />
          </label>
          <span>{unitLabel[rule.unit] ?? "واحد"}</span>
          <button
            type="button"
            aria-label={`حذف نگاشت انبار ${index + 1}`}
            onClick={() => onChange(value.filter((_, position) => position !== index))}
          >
            حذف
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.secondary}
        disabled={value.length >= 100 || !inventory.length}
        onClick={() => onChange([...value, { inventoryItemId: "", quantity: "1", unit: "" }])}
      >
        + نگاشت انبار
      </button>
      {!inventory.length && <p>قلم انبار فعالی وجود ندارد.</p>}
    </div>
  );
}
