import type { Category } from "@/modules/catalog/categories";

export type CategoryList = { items: Category[]; orderRevision: number };
type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

export class CategoryRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function categoryRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
  } catch {
    throw new CategoryRequestError("NETWORK", "ارتباط برقرار نشد. دوباره تلاش کنید.");
  }
  let result: Envelope<T>;
  try {
    result = (await response.json()) as Envelope<T>;
  } catch {
    throw new CategoryRequestError("NETWORK", "پاسخ سرویس معتبر نیست. دوباره تلاش کنید.");
  }
  if (!response.ok || !result.ok) {
    const code = result.ok ? "UNKNOWN" : result.error.code;
    const message =
      code === "CONFLICT"
        ? "اطلاعات دسته‌بندی تغییر کرده یا دارای محصول وابسته است. فهرست را تازه‌سازی کنید."
        : code === "VALIDATION"
          ? "نام یا تصویر دسته‌بندی معتبر نیست."
          : code === "UNAUTHORIZED"
            ? "نشست شما پایان یافته است. دوباره وارد شوید."
            : code === "FORBIDDEN"
              ? "اجازه انجام این کار را ندارید."
              : "درخواست انجام نشد. دوباره تلاش کنید.";
    throw new CategoryRequestError(code, message);
  }
  return result.value;
}

export const categoryList = () => categoryRequest<CategoryList>("/api/categories");
export const categoryKey = (category: Category) => category.id;
