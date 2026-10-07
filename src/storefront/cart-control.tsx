"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cartItemKey } from "@/modules/carts";
import { formatPersianNumber, formatToman } from "@/theme/format";

import { CartLineControl } from "./cart-line-control";
import styles from "./menu.module.css";
import { useMenuCart } from "./menu-cart";
import { quoteSelectedOptions } from "./option-quote";

type Addition = {
  id: string;
  name: string;
  priceToman: number;
  available: boolean;
  imageId: string | null;
};
type Options = {
  id: string;
  name: string;
  description: string;
  basePriceToman: number;
  imageId: string | null;
  orderable: boolean;
  additions: Addition[];
};
type ApiResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

async function apiValue<T>(response: Response): Promise<T> {
  const result = (await response.json()) as ApiResult<T>;
  if (!response.ok || !result.ok)
    throw new Error(result.ok ? "سرویس در دسترس نیست." : result.error.message);
  return result.value;
}

export function CartControl({
  productId,
  orderable,
  hasAdditions = false,
}: {
  productId: string;
  orderable: boolean;
  hasAdditions?: boolean;
}) {
  const { cart, status, dispatch } = useMenuCart();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const quote = options ? quoteSelectedOptions(options, selected, quantity) : null;
  const baseKey = cartItemKey(productId, []);
  const base = cart?.items.find(
    (item) =>
      cartItemKey(
        item.productId,
        item.additions.map((a) => a.additionId),
      ) === baseKey,
  );
  const count =
    cart?.items
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  async function showOptions() {
    if (!orderable) return;
    setOpen(true);
    setAdded(false);
    setLoading(true);
    setOptions(null);
    setSelected([]);
    setQuantity(1);
    setNote("");
    setError("");
    try {
      const response = await fetch(`/api/products/${productId}/options`, { cache: "no-store" });
      const value = await apiValue<Options>(response);
      if (!value.orderable) throw new Error("Product unavailable");
      setOptions(value);
    } catch {
      setError("گزینه‌های محصول در دسترس نیست؛ دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  async function add() {
    if (!options || !quote || saving || (status !== "ready" && status !== "guest")) return;
    setSaving(true);
    setError("");
    try {
      await dispatch({
        type: "add",
        productId,
        productName: options.name,
        additionIds: quote.additionIds,
        additionNames: quote.additionIds.map(
          (id) => options.additions.find((a) => a.id === id)?.name ?? "",
        ),
        additionPricesToman: quote.additionIds.map(
          (id) => options.additions.find((a) => a.id === id)?.priceToman ?? 0,
        ),
        quantity: quote.quantity,
        note: note.trim() || undefined,
        unitPriceToman: quote.unitPriceToman,
      });
      setAdded(true);
    } catch {
      setError("افزودن به سبد انجام نشد. قیمت و موجودی را دوباره بررسی کنید.");
    } finally {
      setSaving(false);
    }
  }

  if (!orderable)
    return (
      <span className={styles.unavailable} aria-label="این محصول ناموجود است">
        ناموجود
      </span>
    );

  return (
    <div className={styles.cartAction}>
      {base && !hasAdditions ? (
        <CartLineControl item={base} />
      ) : (
        <button type="button" className={styles.addButton} onClick={() => void showOptions()}>
          <span className={styles.addIcon} aria-hidden="true">
            +
          </span>{" "}
          افزودن
          {count > 0 ? ` (${formatPersianNumber(count)})` : ""}
        </button>
      )}
      {error && !open && (
        <span className={styles.actionNote} role="alert">
          {error}
        </span>
      )}
      <dialog
        ref={dialog}
        className={styles.optionsDialog}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        onClose={() => setOpen(false)}
        aria-labelledby={`options-title-${productId}`}
      >
        <div className={styles.optionsHeader}>
          <strong id={`options-title-${productId}`}>شخصی‌سازی سفارش</strong>
          <button type="button" aria-label="بستن گزینه‌ها" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        {added ? (
          <div className={styles.addedState} role="status">
            <span aria-hidden="true">✓</span>
            <h2>به سبد خرید شما افزوده شد!</h2>
            <p>{options?.name} با انتخاب‌های شما ثبت شد.</p>
            <Link href="/cart" onClick={() => setOpen(false)}>
              مشاهده سبد خرید
            </Link>
            <button type="button" onClick={() => setOpen(false)}>
              بازگشت به منو
            </button>
          </div>
        ) : loading ? (
          <p className={styles.optionsState} role="status">
            در حال دریافت گزینه‌ها…
          </p>
        ) : options ? (
          <>
            <div className={styles.optionsBody}>
              <div className={styles.optionsProduct}>
                {options.imageId && (
                  <Image
                    className={styles.optionsProductImage}
                    src={`/api/media/${options.imageId}/file?variant=small`}
                    alt={options.name}
                    width={96}
                    height={96}
                    unoptimized
                  />
                )}
                <div className={styles.optionsProductDetails}>
                  <strong>{options.name}</strong>
                  <p>{options.description}</p>
                  <span>قیمت پایه: {formatToman(options.basePriceToman)}</span>
                </div>
              </div>
              <div className={styles.optionsQuantity}>
                <span>تعداد</span>
                <div className={styles.stepper}>
                  <button
                    type="button"
                    aria-label="کم کردن تعداد"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((value) => value - 1)}
                  >
                    −
                  </button>
                  <output aria-live="polite">{formatPersianNumber(quantity)}</output>
                  <button
                    type="button"
                    aria-label="زیاد کردن تعداد"
                    disabled={quantity >= 100}
                    onClick={() => setQuantity((value) => value + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
              {options.additions.length > 0 && (
                <fieldset className={styles.optionsAdditions}>
                  <legend>افزودنی‌های دلخواه (اختیاری)</legend>
                  {options.additions.map((addition) => (
                    <label key={addition.id} className={styles.additionRow}>
                      <span>
                        <strong>{addition.name}</strong>
                        <small>{formatToman(addition.priceToman)}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={selected.includes(addition.id)}
                        disabled={!addition.available}
                        onChange={() => {
                          setSelected((current) =>
                            current.includes(addition.id)
                              ? current.filter((id) => id !== addition.id)
                              : [...current, addition.id],
                          );
                        }}
                      />
                      {!addition.available && <small>ناموجود</small>}
                    </label>
                  ))}
                </fieldset>
              )}
              <label className={styles.noteLabel} htmlFor={`product-note-${productId}`}>
                توضیحات برای باریستا (اختیاری)
              </label>
              <textarea
                id={`product-note-${productId}`}
                maxLength={300}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="مثلاً: بدون یخ، همراه با آب سرد…"
              />
              <small className={styles.noteCount}>{formatPersianNumber(note.length)} / ۳۰۰</small>
              {error && (
                <p className={styles.optionsError} role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className={styles.optionsFooter}>
              <span>
                مبلغ نهایی:{" "}
                <strong aria-live="polite">
                  {quote ? formatToman(quote.totalToman) : "قیمت در دسترس نیست"}
                </strong>
              </span>
              <button
                type="button"
                disabled={!quote || saving || (status !== "ready" && status !== "guest")}
                onClick={() => void add()}
              >
                {saving ? "در حال افزودن…" : "افزودن به سبد"}
              </button>
            </div>
          </>
        ) : (
          <div className={styles.optionsState}>
            <p role="alert">{error}</p>
            <button type="button" onClick={() => void showOptions()}>
              تلاش دوباره
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}
