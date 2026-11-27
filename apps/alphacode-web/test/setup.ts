import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Canvas, settings and Markdown compile on their first lazy import. The default
// one-second DOM query deadline can expire before that cold import on Windows.
configure({ asyncUtilTimeout: 5000 });

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");

beforeEach(() => {
  localStorage.removeItem("alphacode-session-canvas-v1");
  localStorage.removeItem("alphacode-session-canvas-v2");
  localStorage.removeItem("alphacode-language-v1");
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["zh-CN"] });
  // Layout/scroll APIs used by cmdk and FlexLayout are not implemented by jsdom.
  // Define plain descriptors (not vi.spyOn) so per-element vi.spyOn(el, "getBoundingClientRect")
  // creates an own spy instead of mutating a shared prototype mock.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1120 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 700 });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: () => new DOMRect(0, 0, 1120, 700),
  });
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
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  else delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  else delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  if (originalGetBoundingClientRect) Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", originalGetBoundingClientRect);
  else delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  vi.unstubAllGlobals();
});
