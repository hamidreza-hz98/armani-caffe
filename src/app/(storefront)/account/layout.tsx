import type { Metadata } from "next";
import type { ReactNode } from "react";

import { privatePageMetadata } from "@/storefront/seo";

export const metadata: Metadata = { ...privatePageMetadata, title: "حساب کاربری" };

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}
