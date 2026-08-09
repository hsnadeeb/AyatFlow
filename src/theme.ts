import { Platform } from "react-native";

export const colors = {
  bg: "#F7F6F2",
  surface: "#FFFFFF",
  ink: "#1C1C1E",
  inkSoft: "#52525A",
  muted: "#9A9AA1",
  line: "#E9E7E1",
  dark: "#17171B",
  darkSoft: "#24242B",
  error: "#DC2626",

  accent: "#0F766E",
  accentStrong: "#0B5F59",
  accentSoft: "#E2F1EE",
  accentBorder: "rgba(15, 118, 110, 0.30)",
  accentGlow: "rgba(15, 118, 110, 0.38)",

  accent2: "#4F46E5",
  accent2Soft: "#ECEAFB",
  accent2Border: "rgba(79, 70, 229, 0.28)",
  accent2Glow: "rgba(79, 70, 229, 0.32)",
} as const;

export const serif = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "serif",
});

export const radii = {
  card: 22,
  pill: 999,
  control: 34,
} as const;

export const cardShadow = {
  shadowColor: "#1C1C1E",
  shadowOpacity: 0.06,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
} as const;
