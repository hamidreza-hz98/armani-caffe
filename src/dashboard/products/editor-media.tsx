"use client";

import Image from "next/image";

import type { ProductFormFields, UpdateProductField } from "./form-types";
import styles from "./products.module.css";

export function ProductMediaFields({
  mediaIds,
  update,
  onPick,
}: {
  mediaIds: ProductFormFields["mediaIds"];
  update: UpdateProductField;
  onPick: () => void;
}) {
  return (
    <section className={styles.editorSection}>
      <h2>تصاویر محصول</h2>
      <p>برای انتشار حداقل یک تصویر آماده و عمومی لازم است.</p>
      <div className={styles.mediaChips}>
        {mediaIds.map((id, index) => (
          <span key={id}>
            <Image
              src={`/api/media/${id}/file?variant=small`}
              alt={`تصویر ${index + 1} محصول`}
              width={48}
              height={48}
              unoptimized
            />
            <button
              type="button"
              aria-label={`حذف تصویر ${index + 1}`}
              onClick={() =>
                update(
                  "mediaIds",
                  mediaIds.filter((value) => value !== id),
                )
              }
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <button type="button" className={styles.secondary} onClick={onPick}>
        انتخاب از کتابخانه رسانه
      </button>
    </section>
  );
}
