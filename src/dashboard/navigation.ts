import { type AdminCapability, adminCapabilityMap } from "@/shared/admin-capabilities";

export type DashboardRole = "OWNER" | "CASHIER";
export type DashboardLink = Readonly<{
  href: string;
  label: string;
  icon:
    | "grid"
    | "receipt"
    | "coffee"
    | "category"
    | "inventory"
    | "media"
    | "customers"
    | "admins"
    | "settings";
  capability: AdminCapability;
}>;

export const dashboardLinks: readonly DashboardLink[] = [
  { href: "/dashboard", label: "داشبورد", icon: "grid", capability: "admin.access" },
  {
    href: "/dashboard/orders",
    label: "سفارش‌ها و فاکتورها",
    icon: "receipt",
    capability: "orders.read",
  },
  {
    href: "/dashboard/products",
    label: "محصولات و بار قهوه",
    icon: "coffee",
    capability: "catalog.read",
  },
  {
    href: "/dashboard/categories",
    label: "دسته‌بندی‌های منو",
    icon: "category",
    capability: "catalog.read",
  },
  {
    href: "/dashboard/inventory",
    label: "موجودی دانه و انبار",
    icon: "inventory",
    capability: "inventory.read",
  },
  { href: "/dashboard/media", label: "رسانه‌ها و گالری", icon: "media", capability: "media.read" },
  {
    href: "/dashboard/customers",
    label: "مشتریان و وفاداری",
    icon: "customers",
    capability: "customers.read",
  },
  {
    href: "/dashboard/admins",
    label: "مدیران و دسترسی‌ها",
    icon: "admins",
    capability: "admins.read",
  },
  {
    href: "/dashboard/settings",
    label: "تنظیمات سیستم",
    icon: "settings",
    capability: "settings.read",
  },
];

export function linksForRole(role: DashboardRole): readonly DashboardLink[] {
  return dashboardLinks.filter((link) => adminCapabilityMap[role].includes(link.capability));
}

/** Only known internal dashboard destinations may survive an auth redirect. */
export function safeDashboardDestination(value: unknown): string {
  return typeof value === "string" && dashboardLinks.some((link) => link.href === value)
    ? value
    : "/dashboard";
}

export function dashboardSection(value: string): DashboardLink | null {
  return dashboardLinks.find((link) => link.href === `/dashboard/${value}`) ?? null;
}
