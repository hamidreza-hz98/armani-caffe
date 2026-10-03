import type { PaymentSettingsView, ProbeResult } from "./model";

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export class PaymentSettingsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, method = "GET", body?: unknown, key?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      cache: "no-store",
      headers:
        method === "GET"
          ? undefined
          : { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new PaymentSettingsError("NETWORK", "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
  }
  let result: Envelope<T>;
  try {
    result = (await response.json()) as Envelope<T>;
  } catch {
    throw new PaymentSettingsError("NETWORK", "پاسخ سرویس معتبر نیست.");
  }
  if (!response.ok || !result.ok) {
    const code = result.ok ? "UNKNOWN" : result.error.code;
    throw new PaymentSettingsError(
      code,
      code === "CONFLICT"
        ? "تنظیمات تغییر کرده است. صفحه را تازه‌سازی کنید."
        : code === "VALIDATION"
          ? "مقادیر، درگاه نصب‌شده یا اطلاعات محرمانه معتبر نیست."
          : code === "FORBIDDEN"
            ? "تنها مالک به این بخش دسترسی دارد."
            : code === "UNAUTHORIZED"
              ? "نشست شما پایان یافته است."
              : "درخواست انجام نشد.",
    );
  }
  return result.value;
}
export const readPaymentSettings = () =>
  request<PaymentSettingsView>("/api/admin/payment/settings");
export const writePaymentSettings = (body: unknown, key: string) =>
  request<PaymentSettingsView>("/api/admin/payment/settings", "PATCH", body, key);
export const probePayment = (providerId: string) =>
  request<ProbeResult>("/api/admin/payment/probe", "POST", { providerId });
