export type OverviewRange = 7 | 30;
export type OverviewSales = Readonly<{
  localDate: string;
  asOfUtc: string;
  today: { salesToman: number; orderCount: number; averageOrderValueToman: number };
  selected: { salesToman: number; orderCount: number; averageOrderValueToman: number };
}>;
export type OverviewDay = Readonly<{ date: string; salesToman: number; orderCount: number }>;
export type OverviewAttention = Readonly<{
  count: number;
  recent: readonly { code: string; status: string; placedAt: string }[];
}>;
export type OverviewStock = Readonly<{
  count: number;
  items: readonly {
    id: string;
    name: string;
    unit: "gram" | "milliliter" | "piece";
    onHand: number;
    reorderLevel: number;
  }[];
}>;
export type OverviewOrder = Readonly<{
  id: string;
  code: string;
  customerName: string | null;
  totalToman: number;
  status: string;
  paymentStatus: "paid" | "refunded";
  placedAt: string;
}>;
export type OverviewProduct = Readonly<{
  productId: string;
  name: string;
  quantity: number;
  salesToman: number;
}>;
export type OverviewCustomer = Readonly<{
  customerId: string;
  displayName: string | null;
  orderCount: number;
  spentToman: number;
}>;
