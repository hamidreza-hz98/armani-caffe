import type { AdminDetails } from "@/modules/admins";

export type AdminList = {
  items: AdminDetails[];
  total: number;
  stats: { total: number; activeOwners: number; activeCashiers: number; disabled: number };
};
type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export class AdminRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function adminRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
  } catch {
    throw new AdminRequestError("NETWORK", "ارتباط برقرار نشد. دوباره تلاش کنید.");
  }
  let result: Envelope<T>;
  try {
    result = (await response.json()) as Envelope<T>;
  } catch {
    throw new AdminRequestError("NETWORK", "پاسخ سرویس معتبر نیست. دوباره تلاش کنید.");
  }
  if (!response.ok || !result.ok) {
    const code = result.ok ? "UNKNOWN" : result.error.code;
    const message =
      code === "CONFLICT"
        ? "این حساب تغییر کرده، نام کاربری تکراری است، یا آخرین مدیر فعال باید حفظ شود. فهرست را تازه‌سازی کنید."
        : code === "VALIDATION"
          ? "اطلاعات مدیر معتبر نیست. فیلدها را بررسی کنید."
          : code === "FORBIDDEN"
            ? "اجازه انجام این کار را ندارید."
            : code === "UNAUTHORIZED"
              ? "نشست شما پایان یافته است. دوباره وارد شوید."
              : "درخواست انجام نشد. دوباره تلاش کنید.";
    throw new AdminRequestError(code, message);
  }
  return result.value;
}
export const adminList = (query: URLSearchParams) =>
  adminRequest<AdminList>(`/api/admins?${query}`);
