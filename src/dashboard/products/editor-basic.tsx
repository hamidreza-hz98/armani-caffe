"use client";

import type { ProductFormFields, UpdateProductField } from "./form-types";
import styles from "./products.module.css";

export function BasicFields({
  form,
  categories,
  update,
}: {
  form: ProductFormFields;
  categories: readonly { id: string; name: string; status: string }[];
  update: UpdateProductField;
}) {
  return (
    <section className={styles.editorSection}>
      <h2>اطلاعات اصلی</h2>
      <div className={styles.fieldGrid}>
        <label>
          نام محصول{" "}
          <input
            required
            maxLength={160}
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
          />
        </label>
        <label>
          دسته‌بندی{" "}
          <select
            required
            value={form.categoryId}
            onChange={(event) => update("categoryId", event.target.value)}
          >
            <option value="">انتخاب کنید</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.status === "draft" ? " (پیش‌نویس)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          قیمت پایه (تومان){" "}
          <input
            required
            type="number"
            min="0"
            step="1"
            value={form.basePriceToman}
            onChange={(event) => update("basePriceToman", Number(event.target.value))}
          />
        </label>
        <label>
          ترتیب نمایش{" "}
          <input
            type="number"
            min="0"
            step="1"
            value={form.sortOrder}
            onChange={(event) => update("sortOrder", Number(event.target.value))}
          />
        </label>
      </div>
      <label>
        توضیح کوتاه{" "}
        <textarea
          maxLength={300}
          rows={2}
          value={form.excerpt}
          onChange={(event) => update("excerpt", event.target.value)}
        />
      </label>
      <label>
        توضیح کامل{" "}
        <textarea
          maxLength={2000}
          rows={4}
          value={form.description}
          onChange={(event) => update("description", event.target.value)}
        />
      </label>
      <label>
        مواد تشکیل‌دهنده{" "}
        <textarea
          maxLength={2000}
          rows={2}
          value={form.ingredients}
          onChange={(event) => update("ingredients", event.target.value)}
        />
      </label>
      <label className={styles.switchRow}>
        <input
          type="checkbox"
          checked={form.available}
          onChange={(event) => update("available", event.target.checked)}
        />{" "}
        سفارش‌پذیر
      </label>
    </section>
  );
}
