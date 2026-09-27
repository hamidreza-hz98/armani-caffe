import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DesignSystemProvider } from "@/theme/provider";

export const metadata: Metadata = {
  title: "آرمانی کافه",
  description: "وب‌سایت آرمانی کافه",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <DesignSystemProvider>{children}</DesignSystemProvider>
      </body>
    </html>
  );
}
