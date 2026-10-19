import type { AppTheme } from "@shared/types";

// Mirrors the inline script in index.html, which applies the stored theme
// before first paint so a neumorph user never sees a flash of glass.
const THEME_KEY = "splitplus_theme";

export function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  if (theme === "neumorph") root.dataset.theme = "neumorph";
  else delete root.dataset.theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "neumorph" ? "#262a30" : "#0a0807");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}
