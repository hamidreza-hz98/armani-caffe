"use client";

import { useState } from "react";

import { cartItemKey, type CartItemSnapshot } from "@/modules/carts";
import { formatPersianNumber } from "@/theme/format";

import styles from "./menu.module.css";
import { useMenuCart } from "./menu-cart";

export function CartLineControl({
  item,
  showRemove = false,
}: {
  item: CartItemSnapshot;
  showRemove?: boolean;
}) {
  const { dispatch } = useMenuCart();
  const [error, setError] = useState("");
  const key = cartItemKey(
    item.productId,
    item.additions.map((addition) => addition.additionId),
  );
  async function change(quantity: number) {
    setError("");
    try {
      await dispatch({ type: "change", itemKey: key, quantity });
    } catch {
      setError("تغییر تعداد ثبت نشد. دوباره تلاش کنید.");
    }
  }
  return (
    <div className={styles.lineControls}>
      <div className={styles.stepper} aria-label={`تعداد ${item.productName}`}>
        <button
          type="button"
          aria-label={
            item.quantity === 1 ? `حذف ${item.productName}` : `کم کردن ${item.productName}`
          }
          onClick={() => void change(item.quantity - 1)}
        >
          −
        </button>
        <output aria-live="polite">{formatPersianNumber(item.quantity)}</output>
        <button
          type="button"
          aria-label={`زیاد کردن ${item.productName}`}
          onClick={() => void change(Math.min(100, item.quantity + 1))}
          disabled={item.quantity >= 100}
        >
          +
        </button>
      </div>
      {showRemove && (
        <button type="button" className={styles.removeLine} onClick={() => void change(0)}>
          حذف
        </button>
      )}
      {error && (
        <span className={styles.actionNote} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
