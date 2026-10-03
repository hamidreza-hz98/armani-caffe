import type { MediaDetail, MediaSummary, MediaUsage } from "@/modules/media";

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { message: string; code: string } };
const messages: Record<string, string> = {
  VALIDATION: "اطلاعات ارسال‌شده معتبر نیست.",
  CONFLICT: "این رسانه تغییر کرده یا در حال استفاده است. صفحه را تازه‌سازی کنید.",
  FORBIDDEN: "اجازه انجام این کار را ندارید.",
  UNAUTHORIZED: "نشست شما پایان یافته است. دوباره وارد شوید.",
  NOT_FOUND: "رسانه پیدا نشد.",
  UNAVAILABLE: "سرویس رسانه موقتاً در دسترس نیست. دوباره تلاش کنید.",
};

export async function mediaRequest<T>(
  path: string,
  method = "GET",
  data?: unknown,
  key?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
      cache: "no-store",
    });
  } catch {
    throw new Error("اتصال برقرار نشد. دوباره تلاش کنید.");
  }
  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new Error("پاسخ سرویس رسانه معتبر نیست. دوباره تلاش کنید.");
  }
  if (!response.ok || !body.ok)
    throw new Error(
      body.ok ? "درخواست انجام نشد." : (messages[body.error.code] ?? "درخواست انجام نشد."),
    );
  return body.value;
}

export const mediaKey = () => crypto.randomUUID();
export const mediaDetail = (id: string) => mediaRequest<MediaDetail>(`/api/media/${id}`);
export const mediaUsages = (id: string) => mediaRequest<MediaUsage[]>(`/api/media/${id}/usages`);
export type MediaPage = { items: MediaSummary[]; total: number; page: number; pageSize: number };
