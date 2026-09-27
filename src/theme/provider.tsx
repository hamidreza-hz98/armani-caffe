"use client";

import { CssBaseline, ThemeProvider } from "@mui/material";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import rtlPlugin from "@mui/stylis-plugin-rtl";
import type { ReactNode } from "react";
import { prefixer } from "stylis";

import { FeedbackProvider } from "./feedback-provider";
import { theme } from "./theme";

const cacheOptions = { key: "armani-rtl", stylisPlugins: [prefixer, rtlPlugin] };

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={cacheOptions}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <FeedbackProvider>{children}</FeedbackProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
