import { fireEvent, render, screen, within } from "./render";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionContent } from "@/features/sessions/session-content";
import type { Session, SessionMessage } from "@/features/sessions/types";

const user: SessionMessage = { id: "user", role: "user", content: "检查构建" };
const tool = (status: string): SessionMessage => ({
  id: "build", role: "tool", content: "run_command",
  tool: { name: "run_command", description: "构建项目", status, command: "bun run build", output: "构建输出" },
});
const session = (...messages: SessionMessage[]): Session => ({ id: "session", title: "测试", description: "", messages });

describe("reply activity", () => {
  it("only offers copying on the last non-empty assistant block of each completed turn", () => {
    render(<SessionContent session={session(
      user,
      { id: "plan", role: "assistant", content: "先检查项目配置。" },
      tool("succeeded"),
      { id: "answer", role: "assistant", content: "配置检查完成。" },
      { id: "next-user", role: "user", content: "继续检查构建" },
      { id: "next-plan", role: "assistant", content: "接下来运行构建。" },
      { ...tool("succeeded"), id: "next-tool" },
      { id: "next-answer", role: "assistant", content: "构建通过。" },
      { id: "empty", role: "assistant", content: " \n " },
    )} />, { wrapper: TooltipProvider });
    const replies = screen.getAllByRole("article", { name: "AlphaCode 的回复" });
    expect(replies.filter(reply => within(reply).queryByRole("button", { name: "复制回复" }))
      .map(reply => reply.textContent)).toEqual(["配置检查完成。", "构建通过。"]);
    expect(screen.getAllByRole("button", { name: "复制你的消息" })).toHaveLength(2);
  });

  it("keeps intermediate blocks without copy actions while tools or final prose are running", () => {
    const previous = { id: "previous", role: "assistant", content: "上一轮已完成。" } as const;
    const plan = { id: "plan", role: "assistant", content: "先运行构建。" } as const;
    const final = { id: "final", role: "assistant", content: "构建通过。", streaming: true } as const;
    const view = render(<SessionContent session={session(previous, user, plan, tool("running"))} busy phase="running" />, { wrapper: TooltipProvider });
    expect(screen.getAllByRole("button", { name: "复制回复" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "复制回复" }).closest("article")?.textContent).toBe("上一轮已完成。");
    view.rerender(<SessionContent session={session(previous, user, plan, tool("succeeded"), final)} busy phase="thinking" />);
    expect(screen.getAllByRole("button", { name: "复制回复" })).toHaveLength(1);
    view.rerender(<SessionContent session={session(previous, user, plan, tool("succeeded"), final)} phase="idle" />);
    expect(screen.getAllByRole("button", { name: "复制回复" }).map(button => button.closest("article")?.textContent))
      .toEqual(["上一轮已完成。", "构建通过。"]);
  });

  it("keeps one trailing indicator through first-token, streaming, saving and stopping transitions", () => {
    const view = render(<SessionContent session={session(user)} busy phase="thinking" />, { wrapper: TooltipProvider });
    const status = screen.getByRole("status");
    const expectTrailingStatus = (label: string) => {
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toBe(status);
      expect(status.textContent).toBe(label);
      const items = within(screen.getByRole("list", { name: "会话消息" })).getAllByRole("listitem");
      expect(items.at(-1)?.contains(status)).toBe(true);
      expect(status.closest("article")).toBeNull();
    };
    expectTrailingStatus("正在思考");
    expect(status.querySelector('[data-slot="morphing-spinner"]')?.getAttribute("data-active")).toBe("true");
    expect(screen.queryByRole("button", { name: "复制回复" })).toBeNull();

    const reply: SessionMessage = { id: "reply", role: "assistant", content: "构建结果", streaming: true };
    view.rerender(<SessionContent session={session(user, { ...reply, content: " \n " })} busy phase="thinking" />);
    expectTrailingStatus("正在思考");
    expect(screen.queryByRole("article", { name: "AlphaCode 的回复" })).toBeNull();

    view.rerender(<SessionContent session={session(user, reply)} busy phase="thinking" />);
    expectTrailingStatus("正在回复");
    const article = screen.getByRole("article", { name: "AlphaCode 的回复" });
    expect(article.textContent).toBe("构建结果");
    expect(within(article).queryByRole("button", { name: "复制回复" })).toBeNull();

    view.rerender(<SessionContent session={session(user, { ...reply, content: "构建结果：全部通过。", note: "正在记录结果" })} busy phase="thinking" />);
    expectTrailingStatus("正在回复");
    expect(screen.getByText("正在记录结果").compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.rerender(<SessionContent session={session(user, { ...reply, streaming: false })} busy phase="saving" />);
    expectTrailingStatus("正在保存会话");
    view.rerender(<SessionContent session={session(user, reply)} busy connected={false} phase="thinking" />);
    expectTrailingStatus("等待重新连接");
    view.rerender(<SessionContent session={session(user, reply)} busy phase="stopping" />);
    expectTrailingStatus("正在停止");
    // A cached streaming flag must not resurrect an indicator after the run ends.
    view.rerender(<SessionContent session={session(user, reply)} busy={false} phase="idle" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("构建结果")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制回复" })).toBeTruthy();
    view.rerender(<SessionContent session={session(user, { ...reply, content: "" })} phase="idle" />);
    expect(screen.queryByRole("article", { name: "AlphaCode 的回复" })).toBeNull();
  });

  it("resumes feedback below tools and the next reply without empty assistant placeholders", () => {
    const plan: SessionMessage = { id: "plan", role: "assistant", content: "先检查构建。", streaming: true };
    const reply: SessionMessage = { id: "reply", role: "assistant", content: "", streaming: true };
    const view = render(<SessionContent session={session(user, plan)} busy phase="thinking" />, { wrapper: TooltipProvider });
    view.rerender(<SessionContent session={session(user, { ...plan, streaming: false }, tool("running"))} busy phase="running" />);
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(<SessionContent session={session(user, plan, tool("succeeded"), reply)} busy phase="thinking" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("正在思考");
    expect(screen.getAllByRole("article", { name: "AlphaCode 的回复" })).toHaveLength(1);
    expect(screen.getByRole("article", { name: "工具活动" }).compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.rerender(<SessionContent session={session(user, plan, tool("succeeded"), { ...reply, content: "构建通过。" })} busy phase="thinking" />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("正在回复");
    expect(screen.getByText("构建通过。").compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.closest("article")).toBeNull();
  });

  it("opens live tool steps and collapses them when the reply starts without hiding the output controls", () => {
    const view = render(<SessionContent session={session(user, tool("running"))} busy phase="running" />, { wrapper: TooltipProvider });
    const trigger = screen.getByRole("button", { name: /执行过程 · 1 步/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("构建项目")).toBeTruthy();
    expect(screen.queryByText("正在思考")).toBeNull();

    view.rerender(<SessionContent session={session(user, tool("succeeded"), { id: "reply", role: "assistant", content: "构建通过", streaming: true })} busy phase="thinking" />);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("正在回复");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("构建项目"));
    expect(screen.getByText("bun run build")).toBeTruthy();
    expect(screen.getByText("构建输出").closest("details")?.open).toBe(true);
  });

  it("respects manual collapse across live snapshots and distinguishes approval from an executing tool", () => {
    const view = render(<SessionContent session={session(user, tool("awaiting_approval"))} busy phase="running" />, { wrapper: TooltipProvider });
    const trigger = screen.getByRole("button", { name: /执行过程 · 1 步/ });
    expect(trigger.textContent).toContain("1 项待审批");
    expect(screen.getByText("等待审批")).toBeTruthy();
    expect(screen.queryByText("正在思考")).toBeNull();
    fireEvent.click(trigger);
    view.rerender(<SessionContent session={session(user, tool("running"))} busy phase="running" />);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("1 项执行中");
    view.rerender(<SessionContent session={session(user, tool("failed"))} phase="idle" />);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("1 项失败");
  });

  it("shows a disconnected state instead of continuing the live thinking animation", () => {
    const view = render(<SessionContent session={session(user)} busy connected={false} phase="thinking" />, { wrapper: TooltipProvider });
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("等待重新连接");
    expect(status.querySelector('[data-status="running"]')).toBeNull();
    expect(status.querySelector('[data-slot="morphing-spinner"]')?.getAttribute("data-active")).toBe("false");
    view.rerender(<SessionContent session={session(user)} busy phase="thinking" />);
    expect(screen.getByRole("status").textContent).toBe("正在思考");
  });

  it("keeps previous tool steps in their original place when the next reply streams", () => {
    const previous = [user, tool("succeeded"), { id: "answer", role: "assistant", content: "上一轮已完成。" } as const];
    const view = render(<SessionContent session={session(...previous)} />, { wrapper: TooltipProvider });
    const trigger = screen.getByRole("button", { name: /执行过程 · 1 步/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("构建项目"));
    view.rerender(<SessionContent session={session(...previous,
      { id: "next", role: "user", content: "继续检查" },
      { id: "reply", role: "assistant", content: "继续回复", streaming: true },
    )} busy phase="thinking" />);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("构建输出").closest("details")?.open).toBe(true);
    const articles = within(screen.getByRole("list", { name: "会话消息" })).getAllByRole("article");
    expect(articles.map(article => article.getAttribute("aria-label"))).toEqual([
      "你的消息", "工具活动", "AlphaCode 的回复", "你的消息", "AlphaCode 的回复",
    ]);
  });
});
