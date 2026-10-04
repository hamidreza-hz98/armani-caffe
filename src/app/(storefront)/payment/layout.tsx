import type { Metadata } from "next";
import type { ReactNode } from "react";

import { privatePageMetadata } from "@/storefront/seo";

export const metadata: Metadata = { ...privatePageMetadata, title: "نتیجه پرداخت" };

export default function PaymentLayout({ children }: { children: ReactNode }) {
  return children;
}
