import { act, fireEvent, render, screen } from "./render";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionContent } from "@/features/sessions/session-content";
import type { Session } from "@/features/sessions/types";

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
afterEach(() => {
  vi.restoreAllMocks();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

it("follows growing replies at the bottom, pauses while reading history and resumes on returning to the bottom", async () => {
  let height = 400;
  const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>();
  vi.stubGlobal("ResizeObserver", class {
    entry: { callback: ResizeObserverCallback; targets: Set<Element> };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: new Set() };
      observers.add(this.entry);
    }
    observe(target: Element) { this.entry.targets.add(target); }
    unobserve(target: Element) { this.entry.targets.delete(target); }
    disconnect() { observers.delete(this.entry); }
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.dataset.slot === "message-scroller-viewport" ? height : 200;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const viewport = document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]');
    if (this.hasAttribute("data-message-id")) {
      const items = [...(this.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-message-id]") ?? [])];
      const index = items.indexOf(this);
      return new DOMRect(0, index * 100 - (viewport?.scrollTop ?? 0), 800, index === items.length - 1 ? height - index * 100 : 100);
    }
    return new DOMRect(0, 0, 800, 200);
  });
  const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = Math.max(0, Math.min(options.top ?? 0, height - this.clientHeight));
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, writable: true, value: scrollTo });
  const session: Session = { id: "scroll", title: "滚动测试", description: "", local: true, messages: [
    { id: "user", role: "user", content: "检查项目" },
    { id: "reply", role: "assistant", content: "正在检查", streaming: true },
  ] };
  const view = render(<SessionContent session={session} busy phase="thinking" />, { wrapper: TooltipProvider });
  const viewport = screen.getByRole("region", { name: "会话记录" });
  const resize = async () => {
    await act(async () => {
      for (const observer of observers) {
        if ([...observer.targets].some(target => target.getAttribute("data-slot") === "message-scroller-content")) {
          observer.callback([], {} as ResizeObserver);
        }
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
    });
  };
  await resize();
  expect(viewport.scrollTop).toBe(200);
  height = 600;
  view.rerender(<SessionContent session={{ ...session, messages: session.messages.map(message => message.id === "reply" ? { ...message, content: "检查结果正在持续输出" } : message) }} busy phase="thinking" />);
  await resize();
  expect(viewport.scrollTop).toBe(400);

  fireEvent.wheel(viewport, { deltaY: -200 });
  viewport.scrollTop = 150;
  fireEvent.scroll(viewport);
  scrollTo.mockClear();
  height = 800;
  await resize();
  expect(viewport.scrollTop).toBe(150);
  expect(scrollTo).not.toHaveBeenCalled();

  // A new user message must also leave the reader's position alone.
  view.rerender(<SessionContent session={{ ...session, messages: [...session.messages, { id: "next-user", role: "user", content: "继续" }] }} busy phase="thinking" />);
  await act(async () => { await Promise.resolve(); });
  expect(viewport.scrollTop).toBe(150);
  expect(scrollTo).not.toHaveBeenCalled();

  viewport.scrollTop = height - viewport.clientHeight;
  fireEvent.scroll(viewport);
  height = 1000;
  await resize();
  expect(viewport.scrollTop).toBe(800);
});
