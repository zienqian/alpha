import { act, fireEvent, render, screen } from "./render";
import { expect, it, vi } from "vitest";
import { SessionRetry } from "@/features/sessions/session-retry";

it("shows retry count, counts down, and lets the user stop retrying", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const cancel = vi.fn();
  const retry = { attempt: 2, maxAttempts: 5, nextAttemptAt: Date.now() + 2000, errorCode: "REQUEST_FAILED" };
  const view = render(<SessionRetry retry={retry} disabled={false} onCancel={cancel} />);
  try {
    expect(screen.getByRole("status").textContent).toContain("2/5");
    expect(screen.getByText("2 秒后重试，已完成的步骤已保留。")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("正在重新连接模型…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "停止重试" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    view.rerender(<SessionRetry retry={retry} disabled onCancel={cancel} />);
    expect(screen.getByRole("button", { name: "停止重试" }).hasAttribute("disabled")).toBe(true);
  } finally { view.unmount(); vi.useRealTimers(); }
});
