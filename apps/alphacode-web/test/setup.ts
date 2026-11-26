import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Canvas, settings and Markdown compile on their first lazy import. The default
// one-second DOM query deadline can expire before that cold import on Windows.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  localStorage.removeItem("alphacode-experiments-v1");
  localStorage.removeItem("alphacode-session-canvas-v1");
  localStorage.removeItem("alphacode-session-canvas-v2");
  localStorage.removeItem("alphacode-language-v1");
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["zh-CN"] });
  // Layout/scroll APIs used by cmdk are not implemented by jsdom.
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  // ProseMirror measures the caret when pasting and moving through formatted blocks.
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect());
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("max-width") && window.innerWidth < 768,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
