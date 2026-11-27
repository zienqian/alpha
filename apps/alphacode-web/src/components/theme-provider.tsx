import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from "react";
import { syncDesktopAppearance } from "@/components/desktop-titlebar";

// Based on https://ui.shadcn.com/docs/dark-mode/vite, with live system updates,
// transition suppression during theme swaps (better-motion), and a storage fallback.
export type ThemeMode = "light" | "dark" | "system";
export type ColorMode = "light" | "dark";

const storageKey = "alphacode-theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function suppressTransitionsBriefly() {
  if (typeof document === "undefined" || !document.head || !document.body) return;
  const style = document.createElement("style");
  style.append(document.createTextNode("*,*::before,*::after{transition:none !important}"));
  document.head.append(style);
  // Force a synchronous style flush so the new theme paints before restoring transitions.
  void document.body.offsetHeight;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) => window.setTimeout(cb, 0);
  raf(() => {
    raf(() => style.remove());
  });
}

interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: ColorMode;
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeState>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => undefined,
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
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = (suppress: boolean) => {
      const resolved: ColorMode = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      const root = document.documentElement;
      const changed = !root.classList.contains(resolved);
      if (suppress && changed) suppressTransitionsBriefly();
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
      root.style.colorScheme = resolved;
      setResolvedTheme(resolved);
      syncDesktopAppearance(theme);
    };
    applyTheme(mounted.current);
    mounted.current = true;
    if (theme !== "system") return;
    const onMediaChange = () => applyTheme(true);
    media.addEventListener("change", onMediaChange);
    return () => media.removeEventListener("change", onMediaChange);
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
    } catch {
      // Theme switching still works in memory when storage is unavailable.
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
