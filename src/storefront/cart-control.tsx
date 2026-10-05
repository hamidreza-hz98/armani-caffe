"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cartItemKey } from "@/modules/carts";
import { formatPersianNumber, formatToman } from "@/theme/format";

import { CartLineControl } from "./cart-line-control";
import { CUSTOMER_AUTHENTICATED, openCustomerAuth } from "./customer-auth-events";
import styles from "./menu.module.css";
import { useMenuCart } from "./menu-cart";

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
type Quote = {
  productId: string;
  additionIds: string[];
  quantity: number;
  unitPriceToman: number;
  totalToman: number;
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
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const sequence = useRef(0);
  const pendingAuth = useRef(false);
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

  useEffect(() => {
    const resume = () => {
      if (!pendingAuth.current || !options || !quote) return;
      pendingAuth.current = false;
      setOpen(true);
      setSaving(true);
      void dispatch({
        type: "add",
        productId,
        productName: options.name,
        additionIds: quote.additionIds,
        additionNames: quote.additionIds.map(
          (id) => options.additions.find((item) => item.id === id)?.name ?? "",
        ),
        quantity: quote.quantity,
        note: note.trim() || undefined,
        unitPriceToman: quote.unitPriceToman,
      })
        .then(() => setAdded(true))
        .catch(() => setError("افزودن به سبد انجام نشد. قیمت و موجودی را دوباره بررسی کنید."))
        .finally(() => setSaving(false));
    };
    window.addEventListener(CUSTOMER_AUTHENTICATED, resume);
    return () => window.removeEventListener(CUSTOMER_AUTHENTICATED, resume);
  }, [dispatch, note, options, productId, quote]);

  useEffect(() => {
    if (!open || !options) return;
    const controller = new AbortController();
    const request = ++sequence.current;
    const timer = setTimeout(
      () =>
        void fetch(`/api/products/${productId}/options`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ additionIds: selected, quantity }),
          signal: controller.signal,
        })
          .then((response) => apiValue<Quote>(response))
          .then((value) => {
            if (request === sequence.current) setQuote(value);
          })
          .catch(() => {
            if (!controller.signal.aborted && request === sequence.current)
              setError("قیمت‌گذاری در دسترس نیست؛ دوباره تلاش کنید.");
          }),
      100,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, options, productId, quantity, selected]);

  async function showOptions() {
    if (!orderable) return;
    pendingAuth.current = false;
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
    if (!options || !quote || saving || status !== "ready") return;
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
          {hasAdditions ? "انتخاب گزینه‌ها" : "+ افزودن"}
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
                <strong>{options.name}</strong>
                <p>{options.description}</p>
                <span>قیمت پایه: {formatToman(options.basePriceToman)}</span>
              </div>
              <div className={styles.optionsQuantity}>
                <span>تعداد</span>
                <div className={styles.stepper}>
                  <button
                    type="button"
                    aria-label="کم کردن تعداد"
                    disabled={quantity <= 1}
                    onClick={() => {
                      setQuote(null);
                      setQuantity((value) => value - 1);
                    }}
                  >
                    −
                  </button>
                  <output aria-live="polite">{formatPersianNumber(quantity)}</output>
                  <button
                    type="button"
                    aria-label="زیاد کردن تعداد"
                    disabled={quantity >= 100}
                    onClick={() => {
                      setQuote(null);
                      setQuantity((value) => value + 1);
                    }}
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
                          setQuote(null);
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
              {status === "guest" && (
                <p className={styles.optionsError}>برای افزودن به سبد وارد شوید.</p>
              )}
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
                  {quote ? formatToman(quote.totalToman) : "در حال محاسبه…"}
                </strong>
              </span>
              <button
                type="button"
                disabled={!quote || saving || (status !== "ready" && status !== "guest")}
                onClick={() => {
                  if (status === "guest") {
                    pendingAuth.current = true;
                    dialog.current?.close();
                    setOpen(false);
                    openCustomerAuth();
                  } else void add();
                }}
              >
                {saving
                  ? "در حال افزودن…"
                  : status === "guest"
                    ? "ورود و افزودن به سبد"
                    : "افزودن به سبد"}
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
