// Shared visual language for the native app — mirrors the web "liquid glass" look.
export const theme = {
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
    primary: ["#ff8a3d", "#ffab33", "#ffc23d"] as const,
    cover: ["#3a2a12", "#402a1a", "#20180e"] as const,
    card: ["rgba(255,255,255,0.20)", "rgba(255,255,255,0.04)"] as const,
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
