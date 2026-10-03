import { describe, expect, test } from "vitest";

import {
  nextBatchStatus,
  orderFilterParams,
  type OrderRow,
  parseOrderFilters,
  parseOrderNotice,
} from "@/dashboard/orders/model";

const row = (status: OrderRow["status"]): OrderRow => ({
  id: "a".repeat(24),
  code: "AC-0000001",
  customerName: "الف",
  customerPhone: "+989000000000",
  summary: "قهوه",
  totalToman: 100,
  status,
  paymentStatus: "paid",
  revision: 0,
  placedAt: new Date().toISOString(),
});
describe("operational order filters and events", () => {
  test("bounds URL filters and serializes stable quick filters", () => {
    const filters = parseOrderFilters({
      q: "x".repeat(200),
      status: "NEW",
      payment: "paid",
      range: "7d",
      sort: "amount-high",
      page: "2",
    });
    expect(filters.q).toHaveLength(80);
    expect(orderFilterParams(filters).get("status")).toBe("NEW");
    expect(parseOrderFilters({ page: "-1", status: "unknown" }).page).toBe(1);
  });
  test("offers only common forward batch transitions", () => {
    expect(nextBatchStatus([row("NEW"), row("NEW")])).toBe("PREPARING");
    expect(nextBatchStatus([row("NEW"), row("READY")])).toBeNull();
    expect(nextBatchStatus([row("CANCELLED")])).toBeNull();
  });
  test("rejects malformed socket payloads", () => {
    const notice = {
      v: 1,
      type: "order.changed",
      eventId: "a".repeat(24),
      orderId: "b".repeat(24),
      change: "order.confirmed",
      at: new Date().toISOString(),
    };
    expect(parseOrderNotice(notice)).toEqual(notice);
    expect(parseOrderNotice({ ...notice, orderId: "../../secrets" })).toBeNull();
  });
});
