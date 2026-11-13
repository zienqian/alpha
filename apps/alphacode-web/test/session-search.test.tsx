import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { Highlight } from "@/features/sessions/session-search";
import { mockSessionApi } from "./fixtures/session-api";

let api: ReturnType<typeof mockSessionApi>;
beforeEach(() => { window.history.replaceState(null, "", "/"); api = mockSessionApi(); });

async function openSearch() {
  render(<AppProviders><App /></AppProviders>);
  await screen.findByText("此计算机");
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  return screen.getByRole("combobox", { name: "搜索会话内容" });
}

describe("full conversation search", () => {
  it("offers quick actions before chats and opens the selected action with Enter", async () => {
    const input = await openSearch();
    const options = screen.getAllByRole("option");
    expect(options.slice(0, 2).map(option => option.textContent)).toEqual(["新聊天Ctrl+N", "打开文件夹Ctrl+O"]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("dialog", { name: "创建项目" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "搜索会话" })).toBeNull());
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "项目名称" })));
  });

  it("filters quick actions by their translated name and focuses the new chat composer", async () => {
    const input = await openSearch();
    fireEvent.change(input, { target: { value: "新聊天" } });
    const action = await screen.findByRole("option", { name: "新聊天" });
    expect(screen.queryByRole("option", { name: "打开文件夹" })).toBeNull();
    fireEvent.click(action);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "消息草稿" })));
    expect(api.fetch.mock.calls.some(([path, init]) => path === "/api/sessions" && init.method === "POST")).toBe(false);
  });

  it("runs quick-action shortcuts from the search input without interrupting IME composition", async () => {
    const input = await openSearch();
    fireEvent.keyDown(input, { key: "o", ctrlKey: true, isComposing: true, keyCode: 229 });
    expect(screen.getByRole("dialog", { name: "搜索会话" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "o", ctrlKey: true });
    await screen.findByRole("dialog", { name: "创建项目" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "项目名称" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "n", metaKey: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "消息草稿" })));
  });

  it("searches unopened message bodies and highlights every literal occurrence", async () => {
    const input = await openSearch();
    fireEvent.change(input, { target: { value: "主题变量" } });
    const result = await screen.findByRole("option", { name: /项目说明与约定/ });
    await waitFor(() => expect(result.getAttribute("aria-selected")).toBe("true"));
    expect(result.querySelector("mark")?.textContent).toBe("主题变量");
    expect(api.fetch.mock.calls.some(([path]) => path === "/api/sessions/project-notes")).toBe(false);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("heading", { name: "开发约定" }, { timeout: 5000 })).toBeTruthy();
  });

  it("supports keyboard navigation, Escape, and reopening with a clean query", async () => {
    const input = await openSearch();
    const options = screen.getAllByRole("option");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.change(input, { target: { value: "pending" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("聊天")).toBeTruthy();
  });

  it("keeps IME Enter from opening a conversation", async () => {
    const input = await openSearch();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(screen.getByRole("dialog", { name: "搜索会话" })).toBeTruthy();
    fireEvent.compositionEnd(input);
  });

  it("opens from a closed mobile sidebar and selects a result", async () => {
    vi.stubGlobal("innerWidth", 390);
    const input = await openSearch();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.change(input, { target: { value: "主题变量" } });
    fireEvent.click(await screen.findByRole("option", { name: /项目说明与约定/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("heading", { name: "开发约定" })).toBeTruthy();
  });

  it("opens from the mobile search button and dismisses both dialogs after selection", async () => {
    vi.stubGlobal("innerWidth", 390);
    render(<AppProviders><App /></AppProviders>);
    await screen.findByText("此计算机");
    fireEvent.click(screen.getByRole("button", { name: "切换侧栏" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索会话" }));
    const input = screen.getByRole("combobox");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "主题变量" } });
    fireEvent.click(await screen.findByRole("option", { name: /项目说明与约定/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("heading", { name: "开发约定" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "切换侧栏" })));
  });

  it("can interrupt search exit without duplicating the dialog or losing keyboard focus", async () => {
    const input = await openSearch();
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getAllByRole("dialog", { name: "搜索会话" })).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox")));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "搜索会话" })));
  });

  it("restores focus to the main trigger when the sidebar closes during search", async () => {
    const input = await openSearch();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "切换侧栏" })));
  });

  it("shows a retryable error rather than claiming there are no matches", async () => {
    api.overrides.set("/api/sessions/search?q=retry", () => Response.json({ code: "SERVER_ERROR" }, { status: 500 }));
    const input = await openSearch();
    fireEvent.change(input, { target: { value: "retry" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("没有找到匹配的会话")).toBeNull();
    api.overrides.delete("/api/sessions/search?q=retry");
    fireEvent.click(screen.getByRole("button", { name: "重试搜索" }));
    expect(await screen.findByText("没有找到匹配的会话")).toBeTruthy();
  });

  it("cancels superseded searches and does not show stale results", async () => {
    let oldSignal: AbortSignal | null | undefined;
    let complete: ((response: Response) => void) | undefined;
    api.overrides.set("/api/sessions/search?q=old", (init) => {
      oldSignal = init.signal;
      return new Promise(resolve => { complete = resolve; });
    });
    const input = await openSearch();
    fireEvent.change(input, { target: { value: "old" } });
    await waitFor(() => expect(oldSignal).toBeTruthy());
    fireEvent.change(input, { target: { value: "主题变量" } });
    await screen.findByRole("option", { name: /项目说明与约定/ });
    expect(oldSignal?.aborted).toBe(true);
    complete?.(Response.json({ results: [{ session: api.info("workspace-layout"), snippets: [], matchCount: 0 }] }));
    await waitFor(() => expect(screen.queryByRole("option", { name: /搭建前端工作区/ })).toBeNull());
  });

  it("highlights repeated regex characters safely as plain text", () => {
    const { container } = render(<Highlight text="<script> a+b A+B [x]" query="a+b" />);
    expect([...container.querySelectorAll("mark")].map(mark => mark.textContent)).toEqual(["a+b", "A+B"]);
    expect(container.querySelector("script")).toBeNull();
  });
});
