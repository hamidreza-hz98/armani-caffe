"use client";

import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function AdminLoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setMessage(result.error?.message ?? "ورود انجام نشد. دوباره تلاش کنید.");
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setMessage("ارتباط با سرویس برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Box component="form" onSubmit={submit} sx={{ maxWidth: 420, mx: "auto", mt: 8, p: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h1">ورود مدیر</Typography>
        <TextField
          name="username"
          label="نام کاربری یا ایمیل"
          autoComplete="username"
          required
          slotProps={{ htmlInput: { maxLength: 80, dir: "ltr" } }}
        />
        <TextField
          name="password"
          label="رمز عبور"
          type="password"
          autoComplete="current-password"
          required
          slotProps={{ htmlInput: { maxLength: 128, dir: "ltr" } }}
        />
        {message && (
          <Alert severity="error" role="alert">
            {message}
          </Alert>
        )}
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? "در حال ورود…" : "ورود"}
        </Button>
      </Stack>
    </Box>
  );
}
