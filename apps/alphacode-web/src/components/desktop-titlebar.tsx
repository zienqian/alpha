import { useEffect } from "react";
import { HistoryNavigation } from "@/components/history-navigation";

declare global {
  interface Window {
    alphacodeDesktop?: {
      platform: string;
      setAppearance: (appearance: { color: string; symbolColor: string }) => void;
    };
  }
}

export function syncDesktopAppearance() {
  const desktop = window.alphacodeDesktop;
  if (!desktop) return;
  const root = document.documentElement;
  root.dataset.desktop = desktop.platform;
  const styles = getComputedStyle(root);
  desktop.setAppearance({
    color: styles.getPropertyValue("--shell").trim(),
    symbolColor: styles.getPropertyValue("--foreground").trim(),
  });
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
