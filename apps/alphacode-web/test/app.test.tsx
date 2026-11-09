import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";

describe("Session workspace", () => {
  it("starts on a new conversation with the composer as the primary action", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "会话消息" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "消息草稿" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新会话" }).getAttribute("aria-current")).toBe("page");
  });

  it("renders folder navigation and the initial Markdown conversation", async () => {
    render(<AppProviders><App /></AppProviders>);
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    expect(screen.getByRole("navigation", { name: "文件夹与会话" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("搭建前端工作区");
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByText("预览")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "会话消息" })).getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "搭建前端工作区" }).getAttribute("aria-current")).toBe("page");
  });

  it("switches the active session, title and rendered messages", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("项目说明与约定");
    expect(await screen.findByRole("heading", { name: "开发约定" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "一个简单、专注的工作区" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).parentElement?.textContent).toContain("docs");
    expect(screen.getByRole("button", { name: "项目说明与约定" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "搭建前端工作区" }).hasAttribute("aria-current")).toBe(false);
  });

  it("collapses and expands a folder", () => {
    render(<App />);
    const folder = screen.getByRole("button", { name: "文件夹 alphacode-web" });
    fireEvent.click(folder);
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Markdown 渲染预览" })).toBeNull();
    fireEvent.click(folder);
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Markdown 渲染预览" })).toBeTruthy();
  });

  it("keeps drafts separate for each session and cannot send in preview mode", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "下一步检查布局" } });
    fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "整理项目文档" } });
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("下一步检查布局");
    expect((screen.getByRole("button", { name: "发送消息（未连接模型）" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("searches case-insensitive session titles and opens matching collapsed folders", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "文件夹 alphacode-web" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索会话" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索会话或文件夹" }), { target: { value: "  MARKDOWN  " } });
    expect(screen.getByRole("button", { name: "Markdown 渲染预览" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "文件夹 docs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Markdown 渲染预览" }));
    expect(await screen.findByRole("heading", { name: "Markdown 格式预览" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByRole("button", { name: "文件夹 docs" })).toBeTruthy();
  });

  it("searches by folder path and keeps all of its sessions", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "搜索会话" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索会话或文件夹" }), { target: { value: "apps/alphacode-web" } });
    expect(screen.getByRole("button", { name: "搭建前端工作区" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Markdown 渲染预览" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "文件夹 docs" })).toBeNull();
  });

  it("shows a no-results state without discarding the selected conversation", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索会话" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索会话或文件夹" }), { target: { value: "not-found" } });
    expect(screen.getByRole("status").textContent).toBe("没有找到匹配的会话");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("搭建前端工作区");
  });

  it("shows an empty-message state", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "待开始的会话" }));
    expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "会话消息" })).toBeNull();
  });

  it("handles a workspace with no folders or sessions", () => {
    const { rerender } = render(<App folders={[]} />);
    expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
    expect(screen.getByText("暂无工作区")).toBeTruthy();
    rerender(<App folders={[{ id: "empty", name: "empty", path: "empty", sessions: [] }]} />);
    expect(screen.getByText("暂无会话")).toBeTruthy();
  });

  it("opens a mobile drawer and closes it after selecting a session", () => {
    vi.stubGlobal("innerWidth", 390);
    render(<App />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "切换侧栏" }));
    const drawer = screen.getByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "项目说明与约定" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("项目说明与约定");
  });

  it("creates a new local draft without losing the previous text or attachments", () => {
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "实现新的导航" } });
    fireEvent.change(screen.getByLabelText("添加附件"), { target: { files: [new File(["content"], "notes.txt", { type: "text/plain" })] } });
    expect(screen.getByText("notes.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText("notes.txt")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "实现新的导航" }));
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("实现新的导航");
    expect(screen.getByText("notes.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "移除附件 notes.txt" }));
    expect(screen.queryByText("notes.txt")).toBeNull();
  });

  it("does not create duplicate empty drafts and focuses the composer", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(screen.getAllByRole("button", { name: "新会话" })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "消息草稿" }));
  });

  it("moves a new draft to the selected workspace without clearing its content", () => {
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "整理文档" } });
    fireEvent.keyDown(screen.getByRole("button", { name: "选择工作区" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^docs/ }));
    expect(screen.getByRole("button", { name: "选择工作区" }).textContent).toContain("docs");
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("整理文档");
    expect(screen.getByRole("button", { name: "整理文档" }).getAttribute("aria-current")).toBe("page");
  });

  it("opens and focuses search with the keyboard shortcut", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "搜索会话或文件夹" }));
  });

  it("toggles the desktop sidebar with its trigger and keyboard shortcut", () => {
    const { container } = render(<App />);
    const sidebar = container.querySelector('[data-slot="sidebar"][data-state]');
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");
    fireEvent.click(screen.getByRole("button", { name: "切换侧栏" }));
    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");
  });
});
