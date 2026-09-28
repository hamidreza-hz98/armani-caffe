"use client";

import { Alert, Button } from "@mui/material";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminLogout() {
  const router = useRouter();
  const [pending, setPending] = useState(false),
    [error, setError] = useState(false);
  async function logout() {
    setPending(true);
    setError(false);
    try {
      const response = await fetch("/api/admin/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error();
      router.replace("/admin/login");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {error && <Alert severity="error">خروج انجام نشد. دوباره تلاش کنید.</Alert>}
      <Button onClick={logout} disabled={pending}>
        خروج
      </Button>
    </>
  );
}
