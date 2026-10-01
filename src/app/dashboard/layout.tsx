import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { template: "%s | مدیریت کافه آرمانی", default: "مدیریت کافه آرمانی" },
  robots: { index: false, follow: false, nocache: true },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return children;
}
