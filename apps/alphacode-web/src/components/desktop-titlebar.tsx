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
  if (!window.alphacodeDesktop) return null;
  return <div className="desktop-titlebar" aria-hidden="true" />;
}
