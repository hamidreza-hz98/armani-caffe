export type SalesWindow = Readonly<{
  salesToman: number;
  orderCount: number;
  averageOrderValueToman: number;
}>;
export type DashboardAnalytics = Readonly<{
  timezone: "Asia/Tehran";
  localDate: string;
  asOfUtc: string;
  today: SalesWindow;
  thirtyDays: SalesWindow;
  latestOrders: readonly {
    id: string;
    code: string;
    customerName: string | null;
    totalToman: number;
    status: string;
    paymentStatus: "paid" | "refunded";
    placedAt: string;
  }[];
  bestCustomers: readonly {
    customerId: string;
    displayName: string | null;
    orderCount: number;
    spentToman: number;
  }[];
  bestProducts: readonly {
    productId: string;
    name: string;
    quantity: number;
    salesToman: number;
  }[];
  lowStock: readonly {
    id: string;
    name: string;
    unit: "gram" | "milliliter" | "piece";
    onHand: number;
    reorderLevel: number;
  }[];
}>;
