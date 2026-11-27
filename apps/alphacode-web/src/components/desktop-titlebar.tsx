import { useEffect } from "react";
import type { ThemeMode } from "@/components/theme-provider";

declare global {
  interface Window {
    alphacodeDesktop?: {
      platform: string;
      translucent?: boolean;
      selectDirectory?: () => Promise<string | null>;
      notify?: (notification: { sessionId: string; title: string; kind: "completed" | "approval" | "failed" }) => void;
      onNotificationClick?: (listener: (sessionId: string) => void) => () => void;
      setAppearance: (appearance: { color: string; symbolColor: string; theme?: ThemeMode }) => void;
    };
  }
}

// Electron's bridge intentionally accepts #rrggbb only. Canvas converts CSS
// colors (including OKLCH/color-mix) to sRGB without broadening that IPC API.
export function desktopColor(value: string): string | undefined {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  if (!CSS.supports("color", value)) return;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  return `#${Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function syncDesktopAppearance(theme?: ThemeMode) {
  const desktop = window.alphacodeDesktop;
  if (!desktop) return;
  const root = document.documentElement;
  root.dataset.desktop = desktop.platform;
  if (desktop.translucent) root.dataset.translucent = "true";
  else delete root.dataset.translucent;
  const styles = getComputedStyle(root);
  const rawSurface = styles.getPropertyValue("--shell").trim() || styles.getPropertyValue("--background").trim();
  const color = desktopColor(rawSurface);
  const symbolColor = desktopColor(styles.getPropertyValue("--foreground").trim());
  if (color && symbolColor) {
    desktop.setAppearance(theme ? { color, symbolColor, theme } : { color, symbolColor });
  }
}

export function DesktopTitlebar() {
  useEffect(() => {
    if (!window.alphacodeDesktop) return;
    syncDesktopAppearance();
    // CSS hot updates do not rerun the theme provider. Refresh native window
    // controls after Vite applies styles so their foreground stays synchronized.
    const hot = import.meta.hot;
    if (!hot) return;
    const refresh = () => syncDesktopAppearance();
    hot.on("vite:afterUpdate", refresh);
    return () => hot.off("vite:afterUpdate", refresh);
  }, []);

  return null;
}
