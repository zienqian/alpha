import { useEffect } from "react";
import { HistoryNavigation } from "@/components/history-navigation";

declare global {
  interface Window {
    alphacodeDesktop?: {
      platform: string;
      selectDirectory?: () => Promise<string | null>;
      setAppearance: (appearance: { color: string; symbolColor: string }) => void;
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

export function syncDesktopAppearance() {
  const desktop = window.alphacodeDesktop;
  if (!desktop) return;
  const root = document.documentElement;
  root.dataset.desktop = desktop.platform;
  const styles = getComputedStyle(root);
  const color = desktopColor(styles.getPropertyValue("--shell").trim());
  const symbolColor = desktopColor(styles.getPropertyValue("--foreground").trim());
  if (color && symbolColor) desktop.setAppearance({ color, symbolColor });
}

export function DesktopTitlebar() {
  useEffect(() => {
    if (!window.alphacodeDesktop) return;
    syncDesktopAppearance();
    // CSS hot updates do not rerun the theme provider. Refresh native window
    // controls after Vite applies styles so their background stays with --shell.
    const hot = import.meta.hot;
    if (!hot) return;
    hot.on("vite:afterUpdate", syncDesktopAppearance);
    return () => hot.off("vite:afterUpdate", syncDesktopAppearance);
  }, []);

  return <header className="window-header">
    <HistoryNavigation />
  </header>;
}
