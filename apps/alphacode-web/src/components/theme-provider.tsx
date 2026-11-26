import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type PropsWithChildren } from "react";
import { syncDesktopAppearance } from "@/components/desktop-titlebar";

// Based on https://ui.shadcn.com/docs/dark-mode/vite, with live system updates
// and a storage fallback for browsers that disallow localStorage.
export type ThemeMode = "light" | "dark" | "system";
export type ColorMode = "light" | "dark";

const storageKey = "alphacode-theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: ColorMode;
  setTheme: (theme: ThemeMode) => void;
  storageError: boolean;
}

const ThemeContext = createContext<ThemeState>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => undefined,
  storageError: false,
});

function readSavedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(storageKey);
    return isThemeMode(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, updateTheme] = useState<ThemeMode>(readSavedTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ColorMode>("light");
  const [storageError, setStorageError] = useState(false);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved: ColorMode = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
      root.style.colorScheme = resolved;
      setResolvedTheme(resolved);
      syncDesktopAppearance();
    };
    applyTheme();
    if (theme !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === storageKey || event.key === null) {
        updateTheme(isThemeMode(event.newValue) ? event.newValue : "system");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    if (!isThemeMode(next)) return;
    updateTheme(next);
    try {
      localStorage.setItem(storageKey, next);
      setStorageError(false);
    } catch {
      // Theme switching still works in memory when storage is unavailable.
      setStorageError(true);
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, storageError }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
