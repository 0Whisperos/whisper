import { useCallback, useEffect, useMemo, useState } from "react";

import type { ThemeMode } from "../types";

const STORAGE_KEY = "whisper.authenticated.themeMode";

function readSavedTheme(): ThemeMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "system" || value === "light" || value === "dark") {
      return value;
    }
  } catch {
    // Storage can be disabled in desktop webviews or tests.
  }
  return "system";
}

function saveTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Theme switching should keep working even when persistence is unavailable.
  }
}

export function useThemeMode() {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readSavedTheme());
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) {
      return undefined;
    }
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    saveTheme(mode);
  }, []);

  const appliedTheme = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;

  return useMemo(() => ({
    themeMode,
    appliedTheme,
    setThemeMode,
  }), [appliedTheme, setThemeMode, themeMode]);
}
