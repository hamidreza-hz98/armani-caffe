import type { Metadata } from "next";
import type { ReactNode } from "react";

import { privatePageMetadata } from "@/storefront/seo";

export const metadata: Metadata = { ...privatePageMetadata, title: "سبد خرید" };

export default function CartLayout({ children }: { children: ReactNode }) {
  return children;
}
