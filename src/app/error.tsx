"use client";

import { Button, Container, Stack, Typography } from "@mui/material";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container component="main" maxWidth="sm" sx={{ py: 10 }}>
      <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
        <Typography component="h1" variant="h4">
          مشکلی پیش آمد
        </Typography>
        <Typography>درخواست شما انجام نشد. لطفاً دوباره تلاش کنید.</Typography>
        <Button variant="contained" onClick={reset}>
          تلاش دوباره
        </Button>
      </Stack>
    </Container>
  );
}
