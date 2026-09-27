"use client";

import type { Shadows } from "@mui/material/styles";
import { createTheme } from "@mui/material/styles";

import { colors, elevation, minimumTouchTarget, shape } from "./tokens";

const shadows = Array.from({ length: 25 }, (_, level) =>
  level === 0
    ? "none"
    : level === 1
      ? elevation.card
      : level === 2
        ? elevation.raised
        : elevation.overlay,
) as Shadows;

export const theme = createTheme({
  cssVariables: { cssVarPrefix: "armani" },
  direction: "rtl",
  spacing: 8,
  shape: { borderRadius: shape.control },
  breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
  palette: {
    mode: "light",
    primary: { main: colors.primary, contrastText: colors.surface },
    secondary: { main: colors.brown, contrastText: colors.surface },
    success: { main: colors.success, contrastText: "#fff" },
    warning: { main: colors.warning, contrastText: colors.primary },
    error: { main: colors.error, contrastText: "#fff" },
    info: { main: colors.info, contrastText: "#fff" },
    background: { default: colors.canvas, paper: colors.surface },
    text: { primary: colors.text, secondary: colors.textSecondary },
    divider: colors.border,
  },
  typography: {
    fontFamily: '"Vazirmatn Variable", Tahoma, sans-serif',
    h1: { fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 700, lineHeight: 1.35 },
    h2: { fontSize: "clamp(1.65rem, 3.5vw, 2.5rem)", fontWeight: 700, lineHeight: 1.4 },
    h3: { fontSize: "clamp(1.4rem, 2.5vw, 2rem)", fontWeight: 700, lineHeight: 1.45 },
    h4: { fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.5 },
    h5: { fontSize: "1.25rem", fontWeight: 650, lineHeight: 1.55 },
    h6: { fontSize: "1.125rem", fontWeight: 650, lineHeight: 1.6 },
    body1: { fontSize: "1rem", lineHeight: 1.9 },
    body2: { fontSize: "0.875rem", lineHeight: 1.8 },
    button: { fontWeight: 650, textTransform: "none" },
    caption: { fontSize: "0.75rem", lineHeight: 1.7 },
  },
  shadows,
  components: {
    MuiCssBaseline: { styleOverrides: { body: { backgroundColor: colors.canvas } } },
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: { "&.Mui-focusVisible": { outline: `3px solid ${colors.info}`, outlineOffset: 3 } },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { minHeight: minimumTouchTarget, borderRadius: shape.control, paddingInline: 16 },
        contained: {
          "&.MuiButton-colorPrimary": {
            backgroundColor: colors.brown,
            color: colors.surface,
            "&:hover": { backgroundColor: colors.primary },
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { minWidth: minimumTouchTarget, minHeight: minimumTouchTarget } },
    },
    MuiTextField: { defaultProps: { variant: "outlined" } },
    MuiOutlinedInput: {
      styleOverrides: { root: { minHeight: minimumTouchTarget, borderRadius: shape.control } },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: shape.card,
          backgroundColor: colors.surface,
          boxShadow: elevation.card,
        },
      },
    },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: shape.card } } },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: shape.dialog, boxShadow: elevation.overlay } },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: shape.pill, fontWeight: 600 } } },
    MuiLink: { styleOverrides: { root: { textUnderlineOffset: "0.2em" } } },
  },
});
