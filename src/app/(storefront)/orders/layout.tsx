import type { Metadata } from "next";
import type { ReactNode } from "react";

import { privatePageMetadata } from "@/storefront/seo";

export const metadata: Metadata = { ...privatePageMetadata, title: "جزئیات سفارش" };

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return children;
}
