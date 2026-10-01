"use client";

import Link from "next/link";
import { useState } from "react";

import { cartItemKey, type CartItemSnapshot } from "@/modules/carts";
import { formatPersianNumber, formatToman } from "@/theme/format";

import { CartLineControl } from "./cart-line-control";
import styles from "./menu.module.css";
import { MenuCartProvider, useMenuCart } from "./menu-cart";

function ProductNote({ item }: { item: CartItemSnapshot }) {
  const [note, setNote] = useState(item.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { dispatch } = useMenuCart();
  const key = cartItemKey(
    item.productId,
    item.additions.map((addition) => addition.additionId),
  );
  async function save() {
    if (saving || note === item.note) return;
    setSaving(true);
    setError("");
    try {
      await dispatch({ type: "change", itemKey: key, quantity: item.quantity, note });
    } catch {
      setError("یادداشت ثبت نشد. دوباره تلاش کنید.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={styles.cartNote}>
      <label htmlFor={`note-${key}`}>یادداشت این محصول</label>
      <textarea
        id={`note-${key}`}
        maxLength={300}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button type="button" disabled={saving || note === item.note} onClick={() => void save()}>
        {saving ? "در حال ثبت…" : "ثبت یادداشت"}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

function CartContent() {
  const { cart, status, reload } = useMenuCart();
  return (
    <section className={styles.cartPage}>
      <h1>سبد خرید</h1>
      {status === "loading" ? (
        <p role="status">در حال بارگذاری سبد…</p>
      ) : status === "guest" ? (
        <p>
          برای دیدن سبد، <Link href="/account">وارد شوید</Link>.
        </p>
      ) : status === "error" ? (
        <div role="alert">
          <p>سبد خرید در دسترس نیست.</p>
          <button type="button" onClick={() => void reload()}>
            تلاش دوباره
          </button>
        </div>
      ) : !cart?.items.length ? (
        <p>
          سبد خرید شما خالی است. <Link href="/">بازگشت به منو</Link>
        </p>
      ) : (
        <>
          <p>
            {formatPersianNumber(cart.items.reduce((sum, item) => sum + item.quantity, 0))} قلم در
            سبد شماست.
          </p>
          <div className={styles.cartLines}>
            {cart.items.map((item) => {
              const key = cartItemKey(
                item.productId,
                item.additions.map((a) => a.additionId),
              );
              return (
                <article key={key} className={styles.cartLine}>
                  <div className={styles.cartLineTop}>
                    <h2>{item.productName}</h2>
                    <strong>{formatToman(item.lineTotalToman)}</strong>
                  </div>
                  {item.additions.length > 0 && (
                    <ul>
                      {item.additions.map((addition) => (
                        <li key={addition.additionId}>{addition.name}</li>
                      ))}
                    </ul>
                  )}
                  <CartLineControl item={item} showRemove />
                  <ProductNote key={`${key}-${item.note}`} item={item} />
                </article>
              );
            })}
          </div>
          <div className={styles.cartTotal}>
            <span>جمع سبد</span>
            <strong>{formatToman(cart.pricing.totalToman)}</strong>
          </div>
          <p className={styles.cartNext}>ثبت سفارش و پرداخت در مرحلهٔ بعدی فروشگاه تکمیل می‌شود.</p>
          <Link href="/">افزودن محصول دیگر</Link>
        </>
      )}
    </section>
  );
}

export function CartPageClient() {
  return (
    <MenuCartProvider summary={false}>
      <CartContent />
    </MenuCartProvider>
  );
}
