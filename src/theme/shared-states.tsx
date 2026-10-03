"use client";

import { Alert, Box, Button, Drawer, Pagination, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

export function StatusMessage({
  kind,
  title,
  children,
  action,
}: {
  kind: "success" | "info" | "warning" | "error" | "offline" | "stale";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const severity = kind === "offline" || kind === "stale" ? "warning" : kind;
  const symbol = { success: "✓", info: "ℹ", warning: "!", error: "×", offline: "↯", stale: "↻" }[
    kind
  ];
  return (
    <Alert
      severity={severity}
      role={severity === "error" ? "alert" : "status"}
      icon={<span aria-hidden="true">{symbol}</span>}
      action={action}
      sx={{ alignItems: "center", "& .MuiAlert-message": { minWidth: 0 } }}
    >
      <Typography component="strong" variant="body2" sx={{ display: "block", fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Alert>
  );
}

export function EmptyState({
  variant,
  title,
  description,
  action,
}: {
  variant: "first-use" | "filter-empty" | "not-found" | "forbidden";
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const symbols = { "first-use": "+", "filter-empty": "⌕", "not-found": "؟", forbidden: "⊘" };
  return (
    <Stack
      component="section"
      aria-labelledby={`empty-${variant}`}
      spacing={1.5}
      sx={{ alignItems: "center", textAlign: "center", py: 6, px: 2 }}
    >
      <Box
        aria-hidden="true"
        sx={{
          display: "grid",
          placeItems: "center",
          width: 56,
          height: 56,
          borderRadius: "50%",
          bgcolor: "action.hover",
          fontSize: 28,
        }}
      >
        {symbols[variant]}
      </Box>
      <Typography id={`empty-${variant}`} component="h2" variant="h6">
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
        {description}
      </Typography>
      {action}
    </Stack>
  );
}

export function ContentSkeleton({
  rows = 4,
  label = "در حال بارگذاری محتوا",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <Stack aria-busy="true" aria-label={label} role="status" spacing={1.5}>
      <span className="sr-only">{label}</span>
      <Skeleton variant="rounded" height={44} animation="wave" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} variant="rounded" height={64} animation="wave" />
      ))}
    </Stack>
  );
}

export function RtlPagination({
  page,
  count,
  onChange,
  label = "صفحه‌بندی",
}: {
  page: number;
  count: number;
  onChange: (page: number) => void;
  label?: string;
}) {
  return (
    <Pagination
      dir="rtl"
      page={page}
      count={Math.max(1, count)}
      onChange={(_, value) => onChange(value)}
      siblingCount={0}
      boundaryCount={1}
      aria-label={label}
      getItemAriaLabel={(type, value) =>
        type === "page"
          ? `صفحه ${value}`
          : type === "next"
            ? "صفحه بعد"
            : type === "previous"
              ? "صفحه قبل"
              : type === "first"
                ? "صفحه نخست"
                : "صفحه آخر"
      }
    />
  );
}

function AccessibleDrawer({
  open,
  onClose,
  title,
  children,
  side = "left",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  side?: "left" | "right";
}) {
  const titleId = `drawer-${title.replaceAll(" ", "-")}`;
  return (
    <Drawer
      anchor={side}
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          dir: "rtl",
          role: "dialog",
          "aria-modal": true,
          "aria-labelledby": titleId,
          sx: { width: { xs: "min(92vw, 420px)", sm: 420 }, p: 2 },
        },
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <Typography id={titleId} component="h2" variant="h6">
          {title}
        </Typography>
        <Button autoFocus onClick={onClose} aria-label={`بستن ${title}`}>
          بستن
        </Button>
      </Stack>
      <Box sx={{ mt: 2 }}>{children}</Box>
    </Drawer>
  );
}

export function AdvancedFiltersDrawer(props: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return <AccessibleDrawer {...props} title={props.title ?? "فیلترهای پیشرفته"} side="left" />;
}

export function DetailDrawer(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return <AccessibleDrawer {...props} side="left" />;
}

export function OwnerApprovalNotice({ action }: { action?: ReactNode }) {
  return (
    <StatusMessage kind="warning" title="تأیید مالک لازم است" action={action}>
      این درخواست تا زمان تأیید مالک، تغییری در دادهٔ نهایی ایجاد نمی‌کند.
    </StatusMessage>
  );
}

/** One semantic dataset with explicit desktop-table and mobile-card presentations. */
export function ResponsiveTableCards({
  table,
  cards,
  label,
}: {
  table: ReactNode;
  cards: ReactNode;
  label: string;
}) {
  return (
    <Box component="section" aria-label={label}>
      <Box sx={{ display: { xs: "none", md: "block" }, overflowX: "auto" }}>{table}</Box>
      <Box sx={{ display: { xs: "grid", md: "none" }, gap: 1.5 }}>{cards}</Box>
    </Box>
  );
}

export function JalaliDateRange({
  from,
  to,
  onChange,
  error,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  error?: string;
}) {
  const digit = "[0-9\u06F0-\u06F9]";
  const pattern = `${digit}{4}/${digit}{2}/${digit}{2}`;
  return (
    <fieldset
      aria-describedby={error ? "jalali-range-error" : undefined}
      style={{ border: 0, padding: 0, margin: 0 }}
    >
      <legend>بازهٔ تاریخ شمسی</legend>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <label>
          از{" "}
          <input
            dir="ltr"
            inputMode="numeric"
            placeholder="۱۴۰۵/۰۱/۰۱"
            pattern={pattern}
            value={from}
            onChange={(event) => onChange({ from: event.target.value, to })}
          />
        </label>
        <label>
          تا{" "}
          <input
            dir="ltr"
            inputMode="numeric"
            placeholder="۱۴۰۵/۰۱/۳۰"
            pattern={pattern}
            value={to}
            onChange={(event) => onChange({ from, to: event.target.value })}
          />
        </label>
      </Stack>
      {error ? (
        <Typography id="jalali-range-error" role="alert" color="error" variant="caption">
          {error}
        </Typography>
      ) : null}
    </fieldset>
  );
}
