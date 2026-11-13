import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "./render";
import { ContextUsageIndicator } from "@/features/sessions/context-usage";
import type { ContextUsage } from "@/features/sessions/api";

const usage: ContextUsage = { modelId: "codex/gpt-6.1-sol", contextWindow: 500_000, windowSource: "codex",
  tokens: { system: 1500, tools: 7600, messages: 3400, total: 12500 } };

describe("context usage indicator", () => {
  it("opens the breakdown and closes with Escape without losing keyboard focus", async () => {
    render(<ContextUsageIndicator usage={usage} />);
    const button = screen.getByRole("button", { name: "查看上下文用量：3%" });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("~12.5K / 500K")).toBeTruthy();
    expect(screen.getByText("系统提示词")).toBeTruthy();
    expect(screen.getByText("~7.6K")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("does not invent usage or a window for missing metadata", () => {
    render(<ContextUsageIndicator />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("— / —")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows small usage and clamps only the bar when exceeding capacity", () => {
    const { rerender } = render(<ContextUsageIndicator usage={{ ...usage, contextWindow: 1_050_000,
      tokens: { system: 10, tools: 20, messages: 30, total: 60 } }} />);
    fireEvent.click(screen.getByRole("button", { name: "查看上下文用量：0%" }));
    expect(screen.getByText("~60 / 1.05M")).toBeTruthy();
    rerender(<ContextUsageIndicator usage={{ ...usage, contextWindow: 10_000 }} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByRole("button", { name: "查看上下文用量：125%" })).toBeTruthy();
  });

  it("updates an open breakdown when a new request snapshot arrives", () => {
    const { rerender } = render(<ContextUsageIndicator usage={usage} />);
    fireEvent.click(screen.getByRole("button"));
    rerender(<ContextUsageIndicator usage={{ ...usage, tokens: { system: 1500, tools: 7600, messages: 10900, total: 20000 } }} />);
    expect(screen.getByText("~20K / 500K")).toBeTruthy();
    expect(screen.getByText("~10.9K")).toBeTruthy();
  });
});
