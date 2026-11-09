import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

afterEach(() => {
  localStorage.removeItem("alphacode-theme");
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.style.colorScheme = "";
  vi.restoreAllMocks();
});

describe("ThemeProvider", () => {
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
