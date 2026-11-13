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
  vi.restoreAllMocks();
});

describe("ThemeProvider", () => {
  it("syncs the desktop window with the active palette on mount and theme changes", () => {
    const setAppearance = vi.fn();
    vi.stubGlobal("alphacodeDesktop", { platform: "win32", setAppearance });
    const root = document.documentElement;
    root.style.setProperty("--shell", "#e6ebf2");
    root.style.setProperty("--foreground", "#252a34");
    const { result } = renderHook(useTheme, { wrapper: ThemeProvider });
    expect(root.dataset.desktop).toBe("win32");
    expect(setAppearance).toHaveBeenLastCalledWith({ color: "#e6ebf2", symbolColor: "#252a34" });
    act(() => {
      root.style.setProperty("--shell", "#171b22");
      root.style.setProperty("--foreground", "#e7ebf1");
      result.current.setTheme("dark");
    });
    expect(setAppearance).toHaveBeenLastCalledWith({ color: "#171b22", symbolColor: "#e7ebf1" });
  });

  it("persists an explicit choice and restores it on remount", () => {
    const first = renderHook(useTheme, { wrapper: ThemeProvider });
    act(() => first.result.current.setTheme("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("alphacode-theme")).toBe("dark");
    first.unmount();
    const second = renderHook(useTheme, { wrapper: ThemeProvider });
    expect(second.result.current.theme).toBe("dark");
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
