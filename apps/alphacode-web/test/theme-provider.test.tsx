import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

afterEach(() => {
  localStorage.removeItem("alphacode-theme");
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.style.colorScheme = "";
  document.documentElement.style.removeProperty("--shell");
  document.documentElement.style.removeProperty("--foreground");
  delete document.documentElement.dataset.desktop;
  delete document.documentElement.dataset.translucent;
  vi.restoreAllMocks();
});

describe("ThemeProvider", () => {
  it("syncs the desktop window on mount and theme changes", () => {
    const setAppearance = vi.fn();
    vi.stubGlobal("alphacodeDesktop", { platform: "win32", translucent: true, setAppearance });
    const root = document.documentElement;
    root.style.setProperty("--shell", "#ffffff");
    root.style.setProperty("--foreground", "#171717");
    const { result } = renderHook(useTheme, { wrapper: ThemeProvider });
    expect(root.dataset.desktop).toBe("win32");
    expect(root.dataset.translucent).toBe("true");
    expect(setAppearance).toHaveBeenLastCalledWith({ color: "#ffffff", symbolColor: "#171717", theme: "system" });
    act(() => {
      root.style.setProperty("--shell", "#141414");
      root.style.setProperty("--foreground", "#f5f5f5");
      result.current.setTheme("dark");
    });
    expect(setAppearance).toHaveBeenLastCalledWith({ color: "#141414", symbolColor: "#f5f5f5", theme: "dark" });
  });

  it("persists an explicit choice and restores it on remount", () => {
    const first = renderHook(useTheme, { wrapper: ThemeProvider });
    act(() => first.result.current.setTheme("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(first.result.current.resolvedTheme).toBe("dark");
    expect(localStorage.getItem("alphacode-theme")).toBe("dark");
    first.unmount();
    const second = renderHook(useTheme, { wrapper: ThemeProvider });
    expect(second.result.current.theme).toBe("dark");
    expect(second.result.current.resolvedTheme).toBe("dark");
  });

  it("syncs theme changes across windows and falls back when storage is cleared", () => {
    const { result } = renderHook(useTheme, { wrapper: ThemeProvider });
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "alphacode-theme", newValue: "dark" })));
    expect(result.current.theme).toBe("dark");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null })));
    expect(result.current.theme).toBe("system");
  });

  it("keeps switching when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    const { result } = renderHook(useTheme, { wrapper: ThemeProvider });
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("follows system changes only while system mode is selected", () => {
    const listeners = new Set<() => void>();
    const media = { matches: false, addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) };
    vi.stubGlobal("matchMedia", () => media);
    const { result } = renderHook(useTheme, { wrapper: ThemeProvider });
    act(() => { media.matches = true; listeners.forEach((listener) => listener()); });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    act(() => result.current.setTheme("light"));
    expect(listeners.size).toBe(0);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
