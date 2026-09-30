import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { DesignSystemProvider } from "@/theme/provider";

export const metadata: Metadata = {
  title: "آرمانی کافه",
  description: "وب‌سایت آرمانی کافه",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <DesignSystemProvider>{children}</DesignSystemProvider>
      </body>
    </html>
  );
}
