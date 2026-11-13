import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { languageStorageKey } from "@/i18n/provider";
import { mockSessionApi } from "./fixtures/session-api";
import { replaceDraft } from "./fixtures/draft-editor";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.removeItem("alphacode-theme");
  mockSessionApi();
});

const renderApp = () => render(<AppProviders><App /></AppProviders>);
const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("Workspace settings and navigation", () => {
  it("filters only settings by translated labels and options, and clears empty results", async () => {
    window.history.replaceState(null, "", "/settings");
    renderApp();
    const search = await screen.findByRole<HTMLInputElement>("searchbox", { name: "搜索设置" });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: "  DARK  " } });
    expect(screen.getByRole("combobox", { name: "主题" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "语言" })).toBeNull();
    expect(button("项目说明与约定")).toBeTruthy();
    fireEvent.change(search, { target: { value: "missing-setting" } });
    expect(screen.getByText("未找到匹配的设置")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(button("清空搜索"));
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);

    fireEvent.change(search, { target: { value: "语言" } });
    const language = screen.getByRole("combobox", { name: "语言" });
    language.focus();
    fireEvent.change(language, { target: { value: "en" } });
    expect(await screen.findByRole("combobox", { name: "Language" })).toBe(language);
    expect(document.activeElement).toBe(language);
    expect(search.value).toBe("语言");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("preserves the workspace sidebar and supports opening sessions directly from settings", async () => {
    renderApp();
    const session = await screen.findByRole("button", { name: "项目说明与约定" });
    const sidebar = session.closest('[data-slot="sidebar"]');
    const shell = session.closest('[data-slot="sidebar-wrapper"]');
    const width = (shell as HTMLElement).style.getPropertyValue("--sidebar-width");
    fireEvent.click(button("设置"));
    await screen.findByRole("searchbox", { name: "搜索设置" });
    expect(button("项目说明与约定")).toBe(session);
    expect(session.closest('[data-slot="sidebar"]')).toBe(sidebar);
    expect((shell as HTMLElement).style.getPropertyValue("--sidebar-width")).toBe(width);
    fireEvent.click(session);
    // The first history opens the lazy Markdown/highlighter bundle; allow its cold import.
    expect(await screen.findByRole("heading", { name: "开发约定" }, { timeout: 5000 })).toBeTruthy();
    expect(window.location.pathname).toBe("/");
  });

  it("opens a direct settings route and persists appearance and language across a remount", async () => {
    window.history.replaceState(null, "", "/settings");
    const app = renderApp();
    await screen.findByRole("heading", { name: "常规" });
    expect(button("后退").disabled).toBe(true);
    expect(button("前进").disabled).toBe(true);
    expect(screen.queryByRole("textbox", { name: "消息草稿" })).toBeNull();
    expect(button("设置").closest('[data-slot="sidebar-footer"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "切换主题" })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), { target: { value: "dark" } });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("alphacode-theme")).toBe("dark");
    fireEvent.change(screen.getByRole("combobox", { name: "语言" }), { target: { value: "en" } });
    expect(await screen.findByRole("heading", { name: "General" })).toBeTruthy();
    expect(localStorage.getItem(languageStorageKey)).toBe("en");
    app.unmount();
    renderApp();
    expect((await screen.findByRole<HTMLSelectElement>("combobox", { name: "Theme" })).value).toBe("dark");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Language" }).value).toBe("en");
    fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), { target: { value: "light" } });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), { target: { value: "system" } });
    expect(localStorage.getItem("alphacode-theme")).toBe("system");
  });

  it("restores drafts with back/forward and discards forward history after a new navigation", async () => {
    renderApp();
    await screen.findByText("此计算机");
    const input = screen.getByRole("textbox", { name: "消息草稿" });
    replaceDraft(input, "保留这条未发送的消息");
    fireEvent.click(button("设置"));
    await screen.findByRole("heading", { name: "常规" });
    const historyLength = window.history.length;
    fireEvent.click(button("设置"));
    expect(window.history.length).toBe(historyLength);
    fireEvent.click(button("后退"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("保留这条未发送的消息"));
    expect(button("后退").disabled).toBe(true);
    expect(button("前进").disabled).toBe(false);
    fireEvent.click(button("前进"));
    await screen.findByRole("heading", { name: "常规" });
    fireEvent.click(button("后退"));
    await screen.findByRole("textbox", { name: "消息草稿" });
    fireEvent.click(button("项目说明与约定"));
    await screen.findByRole("heading", { name: "开发约定" });
    expect(button("前进").disabled).toBe(true);
  });

  it("selects a session from settings with one history entry and restores settings on back", async () => {
    window.history.replaceState(null, "", "/?session=project-notes");
    renderApp();
    await screen.findByRole("heading", { name: "开发约定" });
    fireEvent.click(button("设置"));
    await screen.findByRole("heading", { name: "常规" });
    expect(button("项目说明与约定")).toBeTruthy();
    expect(button("技能市场")).toBeTruthy();
    expect(button("搜索会话")).toBeTruthy();
    const historyLength = window.history.length;
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox", { name: "搜索会话内容" }), { target: { value: "搭建前端工作区" } });
    fireEvent.click(await screen.findByRole("option", { name: /搭建前端工作区/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.history.length).toBe(historyLength + 1);
    expect(window.location.pathname).toBe("/");
    fireEvent.click(button("后退"));
    await screen.findByRole("heading", { name: "常规" });
    expect(window.location.pathname).toBe("/settings");
    expect(window.location.search).toBe("");
    fireEvent.click(button("返回对话"));
    await screen.findByRole("heading", { name: "项目说明与约定" });
    fireEvent.click(button("后退"));
    await screen.findByRole("heading", { name: "常规" });
    fireEvent.click(button("后退"));
    await screen.findByRole("heading", { name: "项目说明与约定" });
  });

  it("uses /skills and /settings path routes with React Router history", async () => {
    renderApp();
    await screen.findByText("此计算机");
    fireEvent.click(button("技能市场"));
    await screen.findByRole("heading", { name: "技能市场" });
    expect(window.location.pathname).toBe("/skills");
    fireEvent.click(button("设置"));
    await screen.findByRole("heading", { name: "常规" });
    expect(window.location.pathname).toBe("/settings");
    expect(window.location.search).toBe("");
    fireEvent.click(button("后退"));
    await screen.findByRole("heading", { name: "技能市场" });
    fireEvent.click(button("前进"));
    await screen.findByRole("heading", { name: "常规" });
  });

  it("keeps the settings entry available in the collapsed rail", async () => {
    renderApp();
    await screen.findByText("此计算机");
    fireEvent.click(button("切换侧栏"));
    fireEvent.click(button("设置"));
    await screen.findByRole("heading", { name: "常规" });
    expect(button("设置").getAttribute("aria-current")).toBe("page");
  });

  it("closes the mobile drawer when entering settings", async () => {
    vi.stubGlobal("innerWidth", 390);
    renderApp();
    await screen.findByText("此计算机");
    fireEvent.click(button("切换侧栏"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "设置" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("combobox", { name: "主题" })).toBeTruthy();
  });
});
