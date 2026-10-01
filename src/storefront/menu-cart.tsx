"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import type { CartView } from "@/modules/carts";
import { cartItemKey, type CartItemSnapshot, makeCartItemSnapshot } from "@/modules/carts";
import { asToman } from "@/shared/domain";
import { formatPersianNumber, formatToman } from "@/theme/format";

import styles from "./menu.module.css";

type Result =
  { ok: true; value: CartView } | { ok: false; error: { code: string; message: string } };
type Add = {
  type: "add";
  productId: string;
  productName: string;
  additionIds: string[];
  additionNames: string[];
  quantity: number;
  note?: string;
  unitPriceToman: number;
};
type Change = { type: "change"; itemKey: string; quantity: number; note?: string };
type Action = Add | Change;
type Pending = {
  action: Action;
  resolve: (cart: CartView) => void;
  reject: (error: Error) => void;
};
type CartContextValue = {
  cart: CartView | null;
  status: "loading" | "ready" | "guest" | "error";
  message: string;
  dispatch: (action: Action) => Promise<CartView>;
  reload: () => Promise<void>;
};
const CartContext = createContext<CartContextValue | null>(null);

export function useMenuCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("Menu cart context is missing");
  return context;
}

class CartRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function cartRequest(body?: object): Promise<CartView> {
  const response = await fetch("/api/customer/cart", {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const result = (await response.json()) as Result;
  if (!response.ok || !result.ok)
    throw new CartRequestError(
      result.ok ? "UNAVAILABLE" : result.error.code,
      result.ok ? "Cart unavailable" : result.error.message,
    );
  return result.value;
}

function itemKey(item: CartItemSnapshot) {
  return cartItemKey(
    item.productId,
    item.additions.map((addition) => addition.additionId),
  );
}

/** Pending operations are replayed over the last confirmed response, never over an older response. */
export function projectCart(cart: CartView | null, actions: readonly Action[]): CartView | null {
  if (!cart) return null;
  let items = [...cart.items];
  for (const action of actions) {
    if (action.type === "add") {
      const key = cartItemKey(action.productId, action.additionIds);
      const found = items.find((item) => itemKey(item) === key);
      if (found) {
        items = items.map((item) =>
          item === found
            ? makeCartItemSnapshot({
                productId: item.productId,
                productName: item.productName,
                basePriceToman:
                  item.unitPriceToman - item.additions.reduce((sum, a) => sum + a.priceToman, 0),
                additions: item.additions,
                quantity: Math.min(100, item.quantity + action.quantity),
                note: action.note || item.note,
              })
            : item,
        );
      } else {
        items.push(
          makeCartItemSnapshot({
            productId: action.productId,
            productName: action.productName,
            additions: action.additionIds.map((id, index) => ({
              additionId: id,
              name: action.additionNames[index] ?? "",
              priceToman: 0,
            })),
            quantity: action.quantity,
            note: action.note ?? "",
            basePriceToman: action.unitPriceToman,
          }),
        );
      }
    } else if (action.quantity === 0) {
      items = items.filter((item) => itemKey(item) !== action.itemKey);
    } else {
      items = items.map((item) =>
        itemKey(item) === action.itemKey
          ? makeCartItemSnapshot({
              productId: item.productId,
              productName: item.productName,
              basePriceToman:
                item.unitPriceToman - item.additions.reduce((sum, a) => sum + a.priceToman, 0),
              additions: item.additions,
              quantity: action.quantity,
              note: action.note ?? item.note,
            })
          : item,
      );
    }
  }
  const subtotalToman = asToman(items.reduce((sum, item) => sum + item.lineTotalToman, 0));
  return {
    ...cart,
    items,
    pricing: { subtotalToman, discountToman: 0, deliveryToman: 0, totalToman: subtotalToman },
  };
}

export function MenuCartProvider({
  children,
  summary = true,
  initialGuest = false,
}: {
  children: ReactNode;
  summary?: boolean;
  initialGuest?: boolean;
}) {
  const router = useRouter();
  const confirmed = useRef<CartView | null>(null);
  const pending = useRef<Pending[]>([]);
  const running = useRef(false);
  const generation = useRef(0);
  const [cart, setCart] = useState<CartView | null>(null);
  const [status, setStatus] = useState<CartContextValue["status"]>(
    initialGuest ? "guest" : "loading",
  );
  const [message, setMessage] = useState("");
  const publish = () =>
    setCart(
      projectCart(
        confirmed.current,
        pending.current.map((task) => task.action),
      ),
    );

  async function reload() {
    try {
      confirmed.current = await cartRequest();
      setStatus("ready");
      setMessage("");
    } catch (error) {
      setStatus(
        error instanceof CartRequestError && error.code === "UNAUTHORIZED" ? "guest" : "error",
      );
      setMessage("سبد خرید در دسترس نیست. دوباره تلاش کنید.");
    }
    publish();
  }
  useEffect(() => {
    if (initialGuest) return;
    const started = generation.current;
    void cartRequest()
      .then((value) => {
        if (running.current || generation.current !== started) return;
        confirmed.current = value;
        setCart(value);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (running.current || generation.current !== started) return;
        setStatus(
          error instanceof CartRequestError && error.code === "UNAUTHORIZED" ? "guest" : "error",
        );
      });
  }, [initialGuest]);

  async function drain() {
    if (running.current) return;
    running.current = true;
    while (pending.current.length) {
      const task = pending.current[0];
      try {
        if (!confirmed.current) confirmed.current = await cartRequest();
        let next: CartView | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const cart = confirmed.current;
          if (!cart?.id) throw new CartRequestError("CONFLICT", "Cart expired");
          const action = task.action;
          const item =
            action.type === "change"
              ? cart.items.find((entry) => itemKey(entry) === action.itemKey)
              : null;
          if (action.type === "change" && !item)
            throw new CartRequestError("CONFLICT", "Cart item changed");
          const command =
            action.type === "add"
              ? {
                  operation: "add",
                  productId: action.productId,
                  additionIds: action.additionIds,
                  quantity: action.quantity,
                  note: action.note,
                }
              : action.quantity === 0
                ? { operation: "remove", itemKey: action.itemKey }
                : {
                    operation: "update",
                    itemKey: action.itemKey,
                    additionIds: item!.additions.map((addition) => addition.additionId),
                    quantity: action.quantity,
                    note: action.note ?? item!.note ?? "",
                  };
          try {
            next = await cartRequest({ ...command, cartId: cart.id, revision: cart.revision });
            break;
          } catch (error) {
            if (error instanceof CartRequestError && error.code === "CONFLICT" && attempt === 0) {
              confirmed.current = await cartRequest();
              publish();
              continue;
            }
            throw error;
          }
        }
        if (!next) throw new Error("Cart update did not complete");
        confirmed.current = next;
        if (!next.accepted || next.issues.some((issue) => issue.code !== "PRICE_CHANGED"))
          throw new CartRequestError("CONFLICT", "Selected item is no longer available");
        pending.current.shift();
        task.resolve(next);
        setStatus("ready");
        const addedKey =
          task.action.type === "add"
            ? cartItemKey(task.action.productId, task.action.additionIds)
            : null;
        const added = addedKey ? next.items.find((item) => itemKey(item) === addedKey) : null;
        setMessage(
          next.issues.some((issue) => issue.code === "PRICE_CHANGED") ||
            (task.action.type === "add" && added?.unitPriceToman !== task.action.unitPriceToman)
            ? "قیمت به‌روز شد. مبلغ نهایی سبد را بررسی کنید."
            : "",
        );
        publish();
        router.refresh();
      } catch (error) {
        pending.current.shift();
        task.reject(error instanceof Error ? error : new Error("Cart unavailable"));
        setMessage("تغییر سبد ثبت نشد. لطفاً دوباره تلاش کنید.");
        publish();
        try {
          confirmed.current = await cartRequest();
          setStatus("ready");
        } catch {
          confirmed.current = null;
          setStatus("error");
          for (const queued of pending.current.splice(0))
            queued.reject(new Error("Cart unavailable"));
        }
        publish();
      }
    }
    running.current = false;
  }

  function dispatch(action: Action) {
    return new Promise<CartView>((resolve, reject) => {
      generation.current++;
      pending.current.push({ action, resolve, reject });
      publish();
      void drain();
    });
  }
  const count = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  return (
    <CartContext.Provider value={{ cart, status, message, dispatch, reload }}>
      <div className={count && summary ? styles.menuWithCart : undefined}>{children}</div>
      {summary && count > 0 && cart && (
        <aside className={styles.cartSummary} aria-label="خلاصه سبد خرید">
          <div>
            <strong>{formatPersianNumber(count)} قلم در سبد</strong>
            <span>{formatToman(cart.pricing.totalToman)}</span>
          </div>
          <Link href="/cart">مشاهده سبد</Link>
        </aside>
      )}
      {message && (
        <p className={styles.cartMessage} role="status">
          {message}
        </p>
      )}
    </CartContext.Provider>
  );
}
