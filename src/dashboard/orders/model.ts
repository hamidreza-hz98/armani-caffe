import { assertOrderTransition, type OrderStatus } from "@/modules/orders";

export type OrderFilters = {
  q: string;
  status: OrderStatus | "all";
  payment: "all" | "unpaid" | "pending" | "paid" | "refunded";
  range: "all" | "today" | "7d" | "30d";
  sort: "newest" | "oldest" | "amount-high" | "amount-low";
  page: number;
};
export type OrderRow = {
  id: string;
  code: string;
  customerName: string;
  customerPhone: string;
  summary: string;
  totalToman: number;
  status: OrderStatus;
  paymentStatus: "unpaid" | "pending" | "paid" | "refunded";
  revision: number;
  placedAt: string;
};
export type OrderList = {
  items: OrderRow[];
  total: number;
  counts: {
    fulfillment: Record<OrderStatus, number>;
    payment: Record<OrderRow["paymentStatus"], number>;
  };
};
const statuses = ["NEW", "PREPARING", "READY", "COMPLETED", "CANCELLED"] as const;
const payments = ["unpaid", "pending", "paid", "refunded"] as const;
export function parseOrderFilters(raw: Record<string, string | undefined>): OrderFilters {
  const status = raw.status;
  const payment = raw.payment;
  const range = raw.range;
  const sort = raw.sort;
  return {
    q: typeof raw.q === "string" ? raw.q.trim().slice(0, 80) : "",
    status: statuses.find((value) => value === status) ?? "all",
    payment: payments.find((value) => value === payment) ?? "all",
    range: range === "today" || range === "7d" || range === "30d" ? range : "all",
    sort: sort === "oldest" || sort === "amount-high" || sort === "amount-low" ? sort : "newest",
    page: /^\d{1,5}$/u.test(raw.page ?? "") && Number(raw.page) > 0 ? Number(raw.page) : 1,
  };
}
export function orderFilterParams(filters: OrderFilters) {
  const params = new URLSearchParams({ page: String(filters.page) });
  for (const key of ["q", "status", "payment", "range", "sort"] as const) {
    const value = filters[key];
    if (value && value !== "all" && value !== "newest") params.set(key, value);
  }
  return params;
}
export function nextBatchStatus(rows: readonly OrderRow[]): OrderStatus | null {
  if (!rows.length || rows.some((row) => row.status !== rows[0]!.status)) return null;
  const next: Partial<Record<OrderStatus, OrderStatus>> = {
    NEW: "PREPARING",
    PREPARING: "READY",
    READY: "COMPLETED",
  };
  const target = next[rows[0]!.status];
  if (!target) return null;
  assertOrderTransition(rows[0]!.status, target);
  return target;
}
export type OrderNotice = {
  v: 1;
  type: "order.changed";
  eventId: string;
  orderId: string;
  change: string;
  at: string;
};
export function parseOrderNotice(value: unknown): OrderNotice | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return item.v === 1 &&
    item.type === "order.changed" &&
    typeof item.eventId === "string" &&
    /^[a-f\d]{24}$/iu.test(item.eventId) &&
    typeof item.orderId === "string" &&
    /^[a-f\d]{24}$/iu.test(item.orderId) &&
    typeof item.change === "string" &&
    /^order\.[a-z_]+$/u.test(item.change) &&
    typeof item.at === "string" &&
    Number.isFinite(Date.parse(item.at))
    ? (item as OrderNotice)
    : null;
}
