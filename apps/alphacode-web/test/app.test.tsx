import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { mockSessionApi } from "./fixtures/session-api";

let api: ReturnType<typeof mockSessionApi>;
beforeEach(() => { window.history.replaceState(null, "", "/"); api = mockSessionApi(); });

async function renderWorkspace() {
  const view = render(<AppProviders><App /></AppProviders>);
  await screen.findByRole("button", { name: "继续 搭建前端工作区" });
  return view;
}

describe("Session workspace", () => {
  it("starts on a new conversation with the composer as the primary action", async () => {
    await renderWorkspace();
    expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "会话消息" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "消息草稿" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "添加上下文附件" })).toBeNull();
    expect(screen.queryByLabelText("添加附件")).toBeNull();
    expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();
  });

  it("renders folder navigation and the initial Markdown conversation", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    expect(screen.getByRole("navigation", { name: "文件夹与会话" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("搭建前端工作区");
    expect(await screen.findByRole("table", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText("Enter 发送 · Shift+Enter 换行")).toBeNull();
    expect(within(screen.getByRole("list", { name: "会话消息" })).getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "搭建前端工作区" }).getAttribute("aria-current")).toBe("page");
  });

  it("switches the active session, title and rendered messages", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("项目说明与约定");
    expect(await screen.findByRole("heading", { name: "开发约定" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "一个简单、专注的工作区" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).parentElement?.textContent).toBe("项目说明与约定");
    expect(screen.getByRole("button", { name: "项目说明与约定" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "搭建前端工作区" }).hasAttribute("aria-current")).toBe(false);
  });

  it("collapses and expands a folder", async () => {
    await renderWorkspace();
    const folder = screen.getByRole("button", { name: "文件夹 alphacode-web" });
    fireEvent.click(folder);
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Markdown 渲染预览" })).toBeNull();
    fireEvent.click(folder);
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Markdown 渲染预览" })).toBeTruthy();
  });

  it("keeps drafts separate for each session", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "下一步检查布局" } });
    fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "整理项目文档" } });
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("下一步检查布局");
    expect(screen.getByRole("button", { name: "发送消息" })).toBeTruthy();
  });

  it("opens a search dialog, highlights case-insensitive matches, and selects a collapsed session", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "文件夹 alphacode-web" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索会话" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索会话内容" }), { target: { value: "  MARKDOWN  " } });
    const result = await screen.findByRole("option", { name: /Markdown 渲染预览/ });
    expect(result.querySelector("mark")?.textContent).toBe("Markdown");
    fireEvent.click(result);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("heading", { name: "Markdown 格式预览" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "文件夹 docs" })).toBeTruthy();
  });

  it("searches by folder path and keeps all of its sessions", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "搜索会话" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索会话内容" }), { target: { value: "apps/alphacode-web" } });
    expect(await screen.findByRole("option", { name: /搭建前端工作区/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Markdown 渲染预览/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /项目说明与约定/ })).toBeNull();
  });

  it("shows a no-results state without discarding the selected conversation", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索会话" }));
    fireEvent.change(screen.getByRole("combobox", { name: "搜索会话内容" }), { target: { value: "not-found" } });
    expect(await screen.findByText("没有找到匹配的会话")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭搜索" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("搭建前端工作区");
  });

  it("shows an empty-message state", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "待开始的会话" }));
    expect(await screen.findByRole("heading", { name: "这个会话还没有消息" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "会话消息" })).toBeNull();
  });

  it("handles a server with no sessions", async () => {
    api.infos.splice(0);
    render(<AppProviders><App /></AppProviders>);
    expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
    expect(await screen.findByText("暂无会话，请先在 CLI 中开始对话。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "新建会话" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens a mobile drawer and closes it after selecting a session", async () => {
    vi.stubGlobal("innerWidth", 390);
    await renderWorkspace();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "切换侧栏" }));
    const drawer = screen.getByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "项目说明与约定" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("项目说明与约定");
  });

  it("creates a new local draft without losing the previous text", async () => {
    await renderWorkspace();
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "实现新的导航" } });
    const originalDraft = screen.getByRole("button", { name: "新对话" });
    expect(originalDraft.textContent).toBe("新对话");
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(originalDraft);
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("实现新的导航");
  });

  it("does not create duplicate empty drafts and focuses the composer", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "消息草稿" }));
    expect(api.fetch.mock.calls.every(([, init]) => (init.method ?? "GET") === "GET")).toBe(true);
  });

  it("only lists a local draft while it has input, without creating a server session", async () => {
    await renderWorkspace();
    const input = screen.getByRole("textbox", { name: "消息草稿" });
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();
    fireEvent.change(input, { target: { value: "开始新的任务" } });
    expect(screen.getByRole("button", { name: "新对话" }).getAttribute("aria-current")).toBe("page");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();
    expect(api.fetch.mock.calls.every(([, init]) => (init.method ?? "GET") === "GET")).toBe(true);
  });

  it("opens and focuses search with the keyboard shortcut", async () => {
    await renderWorkspace();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "搜索会话内容" }));
  });

  it("toggles the desktop sidebar with its trigger and keyboard shortcut", async () => {
    const { container } = await renderWorkspace();
    const sidebar = container.querySelector('[data-slot="sidebar"][data-state]');
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");
    fireEvent.click(screen.getByRole("button", { name: "切换侧栏" }));
    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");
  });
});
