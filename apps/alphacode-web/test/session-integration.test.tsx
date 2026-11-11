import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { mockSessionApi } from "./fixtures/session-api";

let api: ReturnType<typeof mockSessionApi>;
beforeEach(() => { window.history.replaceState(null, "", "/"); api = mockSessionApi(); });
const renderApp = () => render(<AppProviders><App /></AppProviders>);

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("server session integration", () => {
  it("loads only the index on the welcome screen, without credentials or writes", async () => {
    renderApp();
    await screen.findByRole("button", { name: "搭建前端工作区" });
    // Initial index events may trigger a coalesced refresh before a slow render finishes.
    expect(new Set(api.fetch.mock.calls.filter(([path]) => !path.endsWith("/events")).map(([path]) => path))).toEqual(new Set(["/api/sessions"]));
    expect(api.fetch.mock.calls.every(([, init]) => (init.method ?? "GET") === "GET")).toBe(true);
    expect(api.fetch).toHaveBeenCalledWith("/api/sessions", expect.objectContaining({
      credentials: "omit", redirect: "error", cache: "no-store", signal: expect.any(AbortSignal),
    }));
    expect(api.fetch.mock.calls[0]?.[1].body).toBeUndefined();
  });

  it("opens the /web session URL and renders messages and tool records in server order", async () => {
    window.history.replaceState(null, "", "/?session=project-notes");
    api.view("project-notes").state.messages = [
      { id: "user", role: "user", text: "检查构建" },
      { id: "assistant", role: "assistant", text: "## 构建结果\n\n**需要修复**", note: "Response incomplete" },
      { id: "tool-only-assistant", role: "assistant", text: "" },
      { id: "whitespace-assistant", role: "assistant", text: "  \n  " },
      { id: "tool", role: "tool", text: "run_command", tool: {
        name: "run_command", description: "执行构建", status: "failed", command: "bun run build", cwd: "C:\\work\\alpha",
        output: "<script>unsafe()</script>\nBuild failed", error: "编译失败", exitCode: 1, truncated: true, omittedLines: 8,
      } },
    ];
    renderApp();
    expect(screen.queryByRole("heading", { name: "从这里，开始构建。" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "构建结果" }, { timeout: 5000 })).toBeTruthy();
    const messages = within(screen.getByRole("list", { name: "会话消息" })).getAllByRole("article");
    expect(messages.map((message) => message.getAttribute("aria-label"))).toEqual(["你的消息", "AlphaCode 的回复", "工具活动"]);
    expect(screen.getByRole("button", { name: "项目说明与约定" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();
    const activity = screen.getByRole("button", { name: /执行过程 · 1 步/ });
    expect(activity.getAttribute("aria-expanded")).toBe("false");
    expect(activity.textContent).toContain("1 项失败");
    expect(screen.queryByText("执行构建")).toBeNull();
    fireEvent.click(activity);
    fireEvent.click(screen.getByText("执行构建"));
    expect(screen.getByText("bun run build")).toBeTruthy();
    expect(screen.getByText("编译失败")).toBeTruthy();
    expect(screen.getByText(/省略 8 行/)).toBeTruthy();
    expect(messages[2]?.querySelector("script")).toBeNull();
    expect(screen.getByText("Response incomplete")).toBeTruthy();
    expect([...new Set(api.fetch.mock.calls.filter(([path]) => !path.endsWith("/events")).map(([path]) => path))].sort()).toEqual(["/api/sessions", "/api/sessions/project-notes"]);
  });

  it("groups consecutive tools around prose, keeps expansion across refresh and omits speaker names", async () => {
    window.history.replaceState(null, "", "/?session=project-notes");
    api.view("project-notes").state.messages = [
      { id: "user", role: "user", text: "检查这个项目" },
      { id: "plan", role: "assistant", text: "先读取项目配置。" },
      { id: "read", role: "tool", text: "read_file", tool: { name: "read_file", description: "读取项目配置", status: "succeeded", output: "配置内容" } },
      { id: "empty", role: "assistant", text: "" },
      { id: "build", role: "tool", text: "run_command", tool: { name: "run_command", description: "构建项目", status: "failed", output: "构建失败" } },
      { id: "summary", role: "assistant", text: "需要修复一处配置。" },
      { id: "retry", role: "tool", text: "run_command", tool: { name: "run_command", description: "重新构建", status: "queued" } },
    ];
    renderApp();
    await screen.findByText("需要修复一处配置。");
    const list = screen.getByRole("list", { name: "会话消息" });
    expect(within(list).queryByText("AlphaCode")).toBeNull();
    expect(within(list).getAllByRole("button", { name: "复制回复" })).toHaveLength(1);
    expect(within(list).getByRole("button", { name: "复制回复" }).closest("article")?.textContent).toContain("需要修复一处配置。");
    expect(within(list).getAllByRole("button", { name: /执行过程/ })).toHaveLength(2);
    const firstGroup = screen.getByRole("button", { name: /执行过程 · 2 步/ });
    const secondGroup = screen.getByRole("button", { name: /执行过程 · 1 步/ });
    expect(firstGroup.getAttribute("aria-expanded")).toBe("false");
    expect(secondGroup.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(firstGroup);
    fireEvent.click(screen.getByText("读取项目配置"));
    expect(screen.getByText("配置内容").closest("details")?.open).toBe(true);
    api.view("project-notes").state.messages = api.view("project-notes").state.messages.map((message) =>
      message.id === "read" ? { ...message, tool: { ...message.tool, name: "read_file", description: "读取项目配置", status: "succeeded", output: "更新后的配置内容" } } : message);
    await act(async () => api.publish("project-notes"));
    expect(await screen.findByText("更新后的配置内容")).toBeTruthy();
    expect(firstGroup.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("更新后的配置内容").closest("details")?.open).toBe(true);
    expect(secondGroup.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(firstGroup);
    expect(screen.queryByText("读取项目配置")).toBeNull();
  });

  it("distinguishes loading from empty history and aborts a previous request on switching", async () => {
    const delayed = deferredResponse();
    api.overrides.set("/api/sessions/workspace-layout", () => delayed.promise);
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "搭建前端工作区" }));
    expect(screen.getByRole("status", { name: "正在加载会话历史" })).toBeTruthy();
    expect(screen.queryByText("这个会话还没有消息")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
    expect(await screen.findByRole("heading", { name: "开发约定" })).toBeTruthy();
    expect(api.fetch.mock.calls.find(([path]) => path.endsWith("/workspace-layout"))?.[1].signal?.aborted).toBe(true);
    await act(async () => { delayed.resolve(Response.json(api.views.get("workspace-layout"))); });
    expect(screen.queryByRole("heading", { name: "一个简单、专注的工作区" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("项目说明与约定");
    expect(new URL(window.location.href).searchParams.get("session")).toBe("project-notes");
  });

  it("does not show fake data during index loading and retries an index failure", async () => {
    const delayed = deferredResponse();
    api.overrides.set("/api/sessions", () => delayed.promise);
    renderApp();
    expect(screen.getByText("正在加载会话列表…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "搭建前端工作区" })).toBeNull();
    await act(async () => { delayed.resolve(Response.json({ code: "NOT_FOUND" }, { status: 404 })); });
    expect(await screen.findByText(/无法加载会话列表/)).toBeTruthy();
    expect(screen.queryByText(/暂无会话/)).toBeNull();
    api.overrides.delete("/api/sessions");
    fireEvent.click(screen.getByRole("button", { name: "重试加载列表" }));
    expect(await screen.findByRole("button", { name: "搭建前端工作区" })).toBeTruthy();
  });

  it("reports a missing deep-linked session without falling back to another conversation", async () => {
    window.history.replaceState(null, "", "/?session=deleted-session");
    renderApp();
    expect(await screen.findByText("这个会话不存在或已被删除。")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "会话消息" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "从这里，开始构建。" })).toBeNull();
    api.views.set("deleted-session", { ...api.view("project-notes"), session: { ...api.info("project-notes"), id: "deleted-session" } });
    fireEvent.click(screen.getByRole("button", { name: "重试加载历史" }));
    expect(await screen.findByRole("heading", { name: "开发约定" })).toBeTruthy();
  });

  it("can render a direct history link even when the list fails", async () => {
    window.history.replaceState(null, "", "/?session=project-notes");
    api.overrides.set("/api/sessions", () => Response.json({ code: "NOT_FOUND" }, { status: 404 }));
    renderApp();
    expect(await screen.findByRole("heading", { name: "开发约定" })).toBeTruthy();
    expect(await screen.findByText(/无法加载会话列表/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "项目说明与约定" }).getAttribute("aria-current")).toBe("page");
  });

  it("preserves cached history and the draft if a refresh fails, then recovers", async () => {
    window.history.replaceState(null, "", "/?session=project-notes");
    renderApp();
    await screen.findByRole("heading", { name: "开发约定" });
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "保留我的草稿" } });
    api.overrides.set("/api/sessions/project-notes", () => Response.json({ code: "NOT_FOUND" }, { status: 404 }));
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(await screen.findByText("当前显示上次加载的记录。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "开发约定" })).toBeTruthy();
    api.overrides.delete("/api/sessions/project-notes");
    api.view("project-notes").state.messages = [{ id: "new", role: "assistant", text: "CLI 新增的回复" }];
    fireEvent.click(screen.getByRole("button", { name: "重试加载历史" }));
    expect(await screen.findByText("CLI 新增的回复")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("保留我的草稿");
    expect(screen.queryByText("当前显示上次加载的记录。")).toBeNull();
  });

  it("refreshes the index without moving local drafts when project order changes", async () => {
    renderApp();
    await screen.findByRole("button", { name: "搭建前端工作区" });
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "继续当前项目" } });
    api.info("project-notes").updatedAt = "2026-11-09T03:00:00.000Z";
    api.infos.push({ id: "new", projectId: "docs", workspaceRoot: "docs", title: "CLI 新建会话", updatedAt: "2026-11-09T04:00:00.000Z", status: "ready" });
    await act(async () => api.publish("project-notes"));
    expect(await screen.findByRole("button", { name: "CLI 新建会话" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "继续 搭建前端工作区" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新对话" }).getAttribute("aria-current")).toBe("page");
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("继续当前项目");
  });

  it("restores the chosen conversation on browser navigation and clears the URL for local drafts", async () => {
    window.history.replaceState(null, "", "/?session=project-notes");
    renderApp();
    await screen.findByRole("heading", { name: "开发约定" });
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(new URL(window.location.href).searchParams.has("session")).toBe(false);
    expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("项目说明与约定"));
    expect(await screen.findByRole("heading", { name: "开发约定" })).toBeTruthy();
  });

  it("shows an actionable failure if a standalone dev server returns HTML for /api", async () => {
    api.overrides.set("/api/sessions", () => new Response("<!doctype html><html></html>", { headers: { "Content-Type": "text/html" } }));
    renderApp();
    expect(await screen.findByText(/无法加载会话列表/)).toBeTruthy();
    expect(screen.queryByText(/暂无会话/)).toBeNull();
  });

  it("refreshes the index on its fallback interval and history through SSE", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    window.history.replaceState(null, "", "/?session=project-notes");
    const app = renderApp();
    try {
      await screen.findByRole("heading", { name: "开发约定" });
      api.view("project-notes").state.messages = [{ id: "fresh", role: "assistant", text: "定时刷新后的回复" }];
      await act(async () => api.publish("project-notes"));
      api.infos.push({ ...api.info("project-notes"), id: "new-poll", title: "定时刷新后的会话" });
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(await screen.findByText("定时刷新后的回复")).toBeTruthy();
      expect(await screen.findByRole("button", { name: "定时刷新后的会话" })).toBeTruthy();
    } finally { app.unmount(); vi.useRealTimers(); }
  });

  it("returns to the welcome screen for a draft URL whose in-memory state was lost on reload", async () => {
    window.history.replaceState(null, "", "/?session=project-notes");
    renderApp();
    await screen.findByRole("heading", { name: "开发约定" });
    act(() => {
      window.history.replaceState({ localSessionId: "local-from-before-reload" }, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
    expect(api.fetch.mock.calls.some(([path]) => path.includes("local-from-before-reload"))).toBe(false);
  });
});
