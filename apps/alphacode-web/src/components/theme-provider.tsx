import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type PropsWithChildren } from "react";

// Based on https://ui.shadcn.com/docs/dark-mode/vite, with live system updates
// and a storage fallback for browsers that disallow localStorage.
type Theme = "light" | "dark" | "system";
const storageKey = "alphacode-theme";
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({
  theme: "system", setTheme: () => undefined,
});

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, updateTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return isTheme(saved) ? saved : "system";
    } catch {
      return "system";
    }
  });

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
      root.style.colorScheme = resolved;
    };
    applyTheme();
    if (theme !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        updateTheme(isTheme(event.newValue) ? event.newValue : "system");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    updateTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Theme switching still works in memory when storage is unavailable.
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
