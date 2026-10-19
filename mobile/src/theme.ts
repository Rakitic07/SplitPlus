import type { ViewStyle } from "react-native";
import type { AppTheme } from "./shared/types";

type Gradient = readonly [string, string, ...string[]];

// Shared visual language for the native app — mirrors the web "liquid glass" look.
export const theme = {
  mode: "glass" as AppTheme,
  colors: {
    bg: "#0a0807",
    bgElevated: "#1c1710",
    card: "rgba(255,255,255,0.08)",
    cardStrong: "rgba(255,255,255,0.12)",
    border: "rgba(255,255,255,0.15)",
    text: "#ffffff",
    textDim: "rgba(255,255,255,0.6)",
    textFaint: "rgba(255,255,255,0.4)",
    primary: "#ff8a3d",
    primary2: "#ffab33",
    pink: "#ffc23d",
    green: "#38d9a9",
    red: "#ff6b6b",
    amber: "#ffd43b",
  },
  gradients: {
    primary: ["#ff8a3d", "#ffab33", "#ffc23d"] as Gradient,
    cover: ["#3a2a12", "#402a1a", "#20180e"] as Gradient,
    card: ["rgba(255,255,255,0.20)", "rgba(255,255,255,0.04)"] as Gradient,
  },
  // Extra depth for surfaces; empty for glass, soft extrusion for neumorph.
  surface: {
    raised: {} as ViewStyle,
    inset: {} as ViewStyle,
  },
  radius: { sm: 12, md: 18, lg: 24, xl: 32, pill: 999 },
  spacing: (n: number) => n * 4,
  font: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 26,
    xxl: 34,
  },
};

export type Theme = typeof theme;

export const THEME_KEY = "splitplus_theme";

// For StyleSheet entries: glass keeps its translucent tint, neumorph swaps it
// for a solid extruded (raised) or pressed-in (inset) surface. Border widths
// are left to the caller so toggling an "active" style never shifts layout.
export const raised = (glassBg: string): ViewStyle =>
  theme.mode === "neumorph"
    ? { backgroundColor: theme.colors.card, ...theme.surface.raised }
    : { backgroundColor: glassBg };
export const inset = (glassBg: string): ViewStyle =>
  theme.mode === "neumorph" ? { ...theme.surface.inset } : { backgroundColor: glassBg };

// Styles are created with StyleSheet.create when each screen module first
// loads, so this must run before App is required (see index.ts). Switching
// therefore takes effect on the next launch.
export function applyTheme(mode: AppTheme) {
  if (mode !== "neumorph") return;
  theme.mode = "neumorph";
  Object.assign(theme.colors, {
    bg: "#262a30",
    bgElevated: "#2b2f36",
    card: "#292d33",
    cardStrong: "#2d3138",
    border: "rgba(255,255,255,0.06)",
    textFaint: "rgba(255,255,255,0.45)",
  });
  theme.gradients.cover = ["#30353c", "#2b2f36", "#23262b"];
  theme.gradients.card = ["#2d3138", "#262a30"];
  // Old-architecture RN has a single shadow per view: a dark drop shadow plus
  // lighter top/left and darker bottom/right edges reads as soft extrusion.
  theme.surface.raised = {
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 5 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 6,
    borderTopColor: "rgba(255,255,255,0.09)",
    borderLeftColor: "rgba(255,255,255,0.07)",
    borderBottomColor: "rgba(0,0,0,0.35)",
    borderRightColor: "rgba(0,0,0,0.28)",
  };
  theme.surface.inset = {
    backgroundColor: "#202328",
    borderTopColor: "rgba(0,0,0,0.45)",
    borderLeftColor: "rgba(0,0,0,0.35)",
    borderBottomColor: "rgba(255,255,255,0.07)",
    borderRightColor: "rgba(255,255,255,0.05)",
  };
}
