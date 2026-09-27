export const colors = {
  primary: "#171411",
  brown: "#3A2418",
  brownLight: "#B9855A",
  gold: "#C99A3D",
  canvas: "#F7F2EA",
  surface: "#FFFCF7",
  surfaceVariant: "#EEE4D7",
  text: "#211A16",
  textSecondary: "#6F6259",
  border: "#D8CABB",
  success: "#2E7D5B",
  warning: "#B26A00",
  error: "#B3261E",
  info: "#356A8A",
} as const;

export const shape = { control: 12, card: 16, dialog: 24, pill: 999 } as const;
export const elevation = {
  card: "0 2px 12px rgb(58 36 24 / 8%)",
  raised: "0 8px 24px rgb(58 36 24 / 12%)",
  overlay: "0 20px 48px rgb(23 20 17 / 20%)",
} as const;
export const minimumTouchTarget = 44;
