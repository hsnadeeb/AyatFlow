import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "system" | "light" | "dark";

export type Palette = {
  bg: string;
  surface: string;
  well: string;
  ink: string;
  inkSoft: string;
  muted: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentBorder: string;
  accentGlow: string;
  accent2: string;
  accent2Soft: string;
  accent2Border: string;
  accent2Glow: string;
  error: string;
  success: string;
  warning: string;
  hero: string;
  heroInk: string;
  heroSub: string;
  onAccent: string;
  overlay: string;
  shadow: string;
  shadowOpacity: number;
};

const lightPalette: Palette = {
  bg: "#F6F5F1",
  surface: "#FFFFFF",
  well: "#EFEEE8",
  ink: "#1C1C1E",
  inkSoft: "#5B5B63",
  muted: "#9A9AA1",
  line: "#E8E6DF",
  lineStrong: "#D8D6CD",
  accent: "#0F766E",
  accentStrong: "#0B5F59",
  accentSoft: "#E3F1EE",
  accentBorder: "rgba(15, 118, 110, 0.32)",
  accentGlow: "rgba(15, 118, 110, 0.38)",
  accent2: "#4F46E5",
  accent2Soft: "#ECEAFB",
  accent2Border: "rgba(79, 70, 229, 0.30)",
  accent2Glow: "rgba(79, 70, 229, 0.34)",
  error: "#D64545",
  success: "#1E9E62",
  warning: "#C78A1D",
  hero: "#0D5A53",
  heroInk: "#EAF6F3",
  heroSub: "#A9CBC4",
  onAccent: "#FFFFFF",
  overlay: "rgba(28, 28, 30, 0.35)",
  shadow: "#1C1C1E",
  shadowOpacity: 0.07,
} as const;

const darkPalette: Palette = {
  bg: "#0F1113",
  surface: "#191C1F",
  well: "#22262A",
  ink: "#F0EFEA",
  inkSoft: "#A8A8B0",
  muted: "#71717A",
  line: "#262A2E",
  lineStrong: "#34393E",
  accent: "#2BB5A5",
  accentStrong: "#3CC4B4",
  accentSoft: "#133834",
  accentBorder: "rgba(43, 181, 165, 0.42)",
  accentGlow: "rgba(43, 181, 165, 0.45)",
  accent2: "#8A94F8",
  accent2Soft: "#262B4C",
  accent2Border: "rgba(138, 148, 248, 0.42)",
  accent2Glow: "rgba(138, 148, 248, 0.45)",
  error: "#FF6B6B",
  success: "#3DD68C",
  warning: "#E8B04B",
  hero: "#0F3D38",
  heroInk: "#D9F3EC",
  heroSub: "#7FB8AC",
  onAccent: "#062E2A",
  overlay: "rgba(0, 0, 0, 0.55)",
  shadow: "#000000",
  shadowOpacity: 0.45,
};

export const serif = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "serif",
});

export const radii = {
  card: 22,
  pill: 999,
  control: 34,
  small: 14,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

const THEME_KEY = "ayah-flow:theme-mode";

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
  palette: Palette;
  shadow: {
    shadowColor: string;
    shadowOpacity: number;
    shadowRadius: number;
    shadowOffset: { width: number; height: number };
    elevation: number;
  };
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const systemScheme = useColorScheme();

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((raw) => {
        if (raw === "light" || raw === "dark" || raw === "system") {
          setModeState(raw);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(mode === "system" ? "unspecified" : mode);
  }, [mode]);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(THEME_KEY, next).catch(() => {});
  };

  const isDark = mode === "system" ? systemScheme === "dark" : mode === "dark";
  const palette = isDark ? darkPalette : lightPalette;

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      isDark,
      palette,
      shadow: {
        shadowColor: palette.shadow,
        shadowOpacity: palette.shadowOpacity,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 3,
      },
    }),
    [mode, isDark, palette]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export function useThemedStyles<T>(factory: (theme: ThemeContextValue) => T): T {
  const theme = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(theme), [theme]);
}
