import type { Metadata } from "next";

import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "ورود مدیر | آرمانی کافه",
  robots: { index: false, follow: false },
};
export default function AdminLoginPage() {
  return (
    <main>
      <AdminLoginForm />
    </main>
  );
}
