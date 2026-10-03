export type StockUnit = "gram" | "milliliter" | "piece";
export type InventoryItem = {
  id: string;
  name: string;
  unit: StockUnit;
  onHand: number;
  reorderLevel: number;
  stockStatus: "available" | "low" | "out";
  status: "active" | "archived";
  revision: number;
  updatedAt: string;
};
export type StockRequest = {
  id: string;
  inventoryItemId: string;
  kind: "initial" | "purchase" | "adjustment" | "waste" | "reversal";
  requestedDelta: number;
  unit: StockUnit;
  reason: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  status: "pending" | "approved" | "rejected";
  movementId: string | null;
  createdAt: string;
};
export type StockMovement = {
  id: string;
  inventoryItemId: string;
  delta: number;
  unit: StockUnit;
  reason: string;
  before: number;
  after: number;
  actorKind: "admin" | "system";
  actorId: string | null;
  orderId: string | null;
  reversalOf: string | null;
  createdAt: string;
};
export type StockMapping = {
  itemId: string;
  productId: string;
  productName: string;
  quantityPerUnit: number;
};
export type InventorySnapshot = {
  items: InventoryItem[];
  requests: StockRequest[];
  mappings: StockMapping[];
  actors: Record<string, string>;
  truncated: boolean;
};
export const unitLabels: Record<StockUnit, string> = {
  gram: "گرم",
  milliliter: "میلی‌لیتر",
  piece: "عدد",
};
export const requestLabels: Record<StockRequest["kind"], string> = {
  initial: "موجودی اولیه",
  purchase: "خرید",
  adjustment: "اصلاح",
  waste: "ضایعات",
  reversal: "برگشت حرکت",
};
export const compatibleUnits: Record<StockUnit, readonly string[]> = {
  gram: ["gram", "kilogram"],
  milliliter: ["milliliter", "liter"],
  piece: ["piece"],
};
export const allUnitLabels: Record<string, string> = {
  ...unitLabels,
  kilogram: "کیلوگرم",
  liter: "لیتر",
};
