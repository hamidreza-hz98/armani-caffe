import type { InventorySnapshot, StockMovement } from "./model";

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export class InventoryRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function inventoryRequest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
  } catch {
    throw new InventoryRequestError("NETWORK", "ارتباط برقرار نشد. دوباره تلاش کنید.");
  }
  let envelope: Envelope<T>;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    throw new InventoryRequestError("NETWORK", "پاسخ سرویس معتبر نیست. دوباره تلاش کنید.");
  }
  if (!response.ok || !envelope.ok) {
    const code = envelope.ok ? "UNKNOWN" : envelope.error.code;
    throw new InventoryRequestError(
      code,
      code === "CONFLICT"
        ? "موجودی یا درخواست تغییر کرده است. اطلاعات را تازه‌سازی و دوباره بررسی کنید."
        : code === "VALIDATION"
          ? "اطلاعات واردشده یا واحد اندازه‌گیری معتبر نیست."
          : code === "UNAUTHORIZED"
            ? "نشست شما پایان یافته است. دوباره وارد شوید."
            : code === "FORBIDDEN"
              ? "اجازه انجام این کار را ندارید."
              : "درخواست انجام نشد. دوباره تلاش کنید.",
    );
  }
  return envelope.value;
}
export const loadInventory = () => inventoryRequest<InventorySnapshot>("/api/inventory/overview");
export const loadMovements = (id: string) =>
  inventoryRequest<StockMovement[]>(`/api/inventory/${id}/movements`);
