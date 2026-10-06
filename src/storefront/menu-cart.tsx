"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import type { CartView } from "@/modules/carts";
import { cartItemKey, type CartItemSnapshot, makeCartItemSnapshot } from "@/modules/carts";
import { asToman } from "@/shared/domain";
import { validTableNumber } from "@/shared/table-number";
import { formatPersianNumber, formatToman } from "@/theme/format";

import { CUSTOMER_AUTHENTICATED, CUSTOMER_LOGGED_OUT } from "./customer-auth-events";
import styles from "./menu.module.css";

type Result =
  { ok: true; value: CartView } | { ok: false; error: { code: string; message: string } };
type Add = {
  type: "add";
  productId: string;
  productName: string;
  additionIds: string[];
  additionNames: string[];
  additionPricesToman: number[];
  quantity: number;
  note?: string;
  unitPriceToman: number;
};
type Change = { type: "change"; itemKey: string; quantity: number; note?: string };
type Notes = { type: "notes"; notes: string };
type Table = { type: "table"; tableNumber: number | null };
type Action = Add | Change | Notes | Table;
type Pending = {
  action: Action;
  resolve: (cart: CartView) => void;
  reject: (error: Error) => void;
};
type CartContextValue = {
  cart: CartView | null;
  status: "loading" | "ready" | "guest" | "error";
  message: string;
  busy: boolean;
  dispatch: (action: Action) => Promise<CartView>;
  reload: () => Promise<void>;
  preview: () => Promise<CartView>;
};
const CartContext = createContext<CartContextValue | null>(null);
const GUEST_CART_KEY = "armani.guest-cart";

function emptyCart(): CartView {
  return {
    id: "guest",
    revision: 0,
    items: [],
    notes: "",
    tableNumber: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    pricing: { subtotalToman: 0, discountToman: 0, deliveryToman: 0, totalToman: 0 },
    issues: [],
    checkoutReady: false,
    accepted: true,
  };
}

function readGuestCart(): CartView {
  try {
    const value = JSON.parse(localStorage.getItem(GUEST_CART_KEY) ?? "null") as CartView | null;
    if (value && Array.isArray(value.items) && value.items.length <= 50) return value;
  } catch {
    // Start with a clean guest cart when saved browser data is unavailable or invalid.
  }
  return emptyCart();
}

function saveGuestCart(value: CartView | null) {
  try {
    if (value) localStorage.setItem(GUEST_CART_KEY, JSON.stringify(value));
    else localStorage.removeItem(GUEST_CART_KEY);
  } catch {
    // The current page still supports cart edits if browser storage is unavailable.
  }
}

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

async function previewRequest(cartId: string, revision: number): Promise<CartView> {
  const response = await fetch("/api/customer/cart/preview", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cartId, revision }),
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
  let notes = cart.notes;
  let tableNumber = cart.tableNumber ?? null;
  for (const action of actions) {
    if (action.type === "notes") {
      notes = action.notes;
    } else if (action.type === "table") {
      tableNumber = action.tableNumber;
    } else if (action.type === "add") {
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
              priceToman: action.additionPricesToman[index] ?? 0,
            })),
            quantity: action.quantity,
            note: action.note ?? "",
            basePriceToman:
              action.unitPriceToman -
              action.additionPricesToman.reduce((sum, price) => sum + price, 0),
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
    notes,
    tableNumber,
    items,
    pricing: { subtotalToman, discountToman: 0, deliveryToman: 0, totalToman: subtotalToman },
  };
}

export function MenuCartProvider({
  children,
  summary = true,
  initialGuest = false,
  initialTable = null,
}: {
  children: ReactNode;
  summary?: boolean;
  initialGuest?: boolean;
  initialTable?: number | null;
}) {
  const router = useRouter();
  const confirmed = useRef<CartView | null>(null);
  const pending = useRef<Pending[]>([]);
  const running = useRef(false);
  const previewing = useRef(false);
  const generation = useRef(0);
  const lastTableSync = useRef("");
  const [cart, setCart] = useState<CartView | null>(null);
  const [status, setStatus] = useState<CartContextValue["status"]>(
    initialGuest ? "guest" : "loading",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const publish = useCallback(
    () =>
      setCart(
        projectCart(
          confirmed.current,
          pending.current.map((task) => task.action),
        ),
      ),
    [],
  );

  const reload = useCallback(async () => {
    try {
      let next = await cartRequest();
      const guest = readGuestCart();
      for (const item of guest.items) {
        const result = await cartRequest({
          operation: "add",
          productId: item.productId,
          additionIds: item.additions.map((addition) => addition.additionId),
          quantity: item.quantity,
          note: item.note,
          cartId: next.id,
          revision: next.revision,
        });
        next = result;
      }
      if (guest.notes)
        next = await cartRequest({
          operation: "notes",
          notes: guest.notes,
          cartId: next.id,
          revision: next.revision,
        });
      saveGuestCart(null);
      confirmed.current = next;
      setStatus("ready");
      setMessage("");
    } catch (error) {
      setStatus(
        error instanceof CartRequestError && error.code === "UNAUTHORIZED" ? "guest" : "error",
      );
      setMessage("سبد خرید در دسترس نیست. دوباره تلاش کنید.");
    }
    publish();
  }, [publish]);
  async function preview() {
    if (running.current || pending.current.length || previewing.current)
      throw new CartRequestError("BUSY", "Cart is changing");
    const current = confirmed.current;
    if (!current?.id) throw new CartRequestError("CONFLICT", "Cart unavailable");
    previewing.current = true;
    setBusy(true);
    try {
      const value = await previewRequest(current.id, current.revision);
      confirmed.current = value;
      publish();
      setStatus("ready");
      return value;
    } finally {
      previewing.current = false;
      if (pending.current.length) void drain();
      else setBusy(false);
    }
  }
  useEffect(() => {
    const onAuthenticated = () => void reload();
    const onLoggedOut = () => {
      confirmed.current = null;
      pending.current = [];
      setCart(null);
      setStatus("guest");
    };
    window.addEventListener(CUSTOMER_AUTHENTICATED, onAuthenticated);
    window.addEventListener(CUSTOMER_LOGGED_OUT, onLoggedOut);
    return () => {
      window.removeEventListener(CUSTOMER_AUTHENTICATED, onAuthenticated);
      window.removeEventListener(CUSTOMER_LOGGED_OUT, onLoggedOut);
    };
  });
  useEffect(() => {
    if (initialGuest) return;
    const onOnline = () => void reload();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [initialGuest, reload]);
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
  useEffect(() => {
    if (status !== "guest") return;
    confirmed.current = readGuestCart();
    publish();
  }, [publish, status]);
  useEffect(() => {
    if (initialTable) {
      try {
        sessionStorage.setItem("armani.table", String(initialTable));
      } catch {
        // The current QR URL still applies even if browser storage is unavailable.
      }
    }
    if (status !== "ready" || !cart?.id || busy) return;
    let desired: number | null = initialTable;
    if (!desired) {
      try {
        const stored = Number(sessionStorage.getItem("armani.table"));
        desired = validTableNumber(stored) ? stored : null;
      } catch {
        desired = null;
      }
    }
    if (desired && cart.tableNumber !== desired) {
      const key = `${cart.id}:${desired}`;
      if (lastTableSync.current === key) return;
      lastTableSync.current = key;
      void dispatch({ type: "table", tableNumber: desired }).catch(() => {
        setMessage("شمارهٔ میز ثبت نشد. صفحه را دوباره بارگذاری کنید.");
      });
    }
  });

  async function drain() {
    if (running.current || previewing.current) return;
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
              : action.type === "notes"
                ? { operation: "notes", notes: action.notes }
                : action.type === "table"
                  ? { operation: "table", tableNumber: action.tableNumber }
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
    setBusy(false);
  }

  function dispatch(action: Action) {
    return new Promise<CartView>((resolve, reject) => {
      generation.current++;
      if (status === "guest") {
        try {
          const current = confirmed.current ?? readGuestCart();
          const updated = projectCart(current, [action]);
          if (!updated) throw new Error("Guest cart unavailable");
          const next = { ...updated, revision: current.revision + 1 };
          confirmed.current = next;
          saveGuestCart(next);
          setCart(next);
          resolve(next);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Guest cart unavailable"));
        }
        return;
      }
      pending.current.push({ action, resolve, reject });
      setBusy(true);
      publish();
      if (!previewing.current) void drain();
    });
  }
  const count = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  return (
    <CartContext.Provider value={{ cart, status, message, busy, dispatch, reload, preview }}>
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
