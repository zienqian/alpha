import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { canvasStorageKey, legacyCanvasStorageKey, readCanvas, saveCanvas, addPanel, collapseGroup, collapseAxis, emptyCanvas, focusPanel, getPanels, getTabsets, focusedTab, isCollapsed, minimumSize, sessionIdOf } from "@/features/session-canvas/layout";
import { experimentsStorageKey } from "@/features/settings/experimental-features";
import { mockSessionApi } from "./fixtures/session-api";
import { replaceDraft } from "./fixtures/draft-editor";
import { Actions, DockLocation, Model } from "flexlayout-react";
import * as historyBuilder from "@/features/sessions/domain/history";

let api: ReturnType<typeof mockSessionApi>;
beforeEach(() => {
  window.history.replaceState(null, "", "/?session=project-notes");
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1120);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1120, 700));
  api = mockSessionApi();
});
afterEach(() => vi.restoreAllMocks());
function renderCanvas() {
  localStorage.setItem(experimentsStorageKey, JSON.stringify({ version: 1, sessionCanvas: true }));
  return render(<AppProviders><App /></AppProviders>);
}
const panel = (title: string) => screen.getByRole("region", { name: title });
const editor = (title: string) => within(panel(title)).getByRole("textbox", { name: "消息草稿" });
async function addSecond() {
  const entry = await screen.findByRole("button", { name: "搭建前端工作区" });
  expect(entry.getAttribute("data-canvas-draggable")).toBe("true");
  fireEvent.keyDown(screen.getByRole("button", { name: "搭建前端工作区 的更多操作" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "添加到画布" }));
  await waitFor(() => expect(document.querySelectorAll(".session-canvas-panel")).toHaveLength(2));
  await waitFor(() => expect(api.streams.get("/api/sessions/workspace-layout/events")?.size).toBe(1));
}

function pointer(target: Element | Document, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" }, isPrimary: { value: true } });
  fireEvent(target, event);
}

describe("experimental session canvas", () => {
  it.each(["title", "body"])("adds fifth and sixth conversations to a two-column layout via a %s drop", async destination => {
    const saved = emptyCanvas();
    for (const id of ["project-notes", "workspace-layout", "markdown-preview", "navigation-states"]) addPanel(saved, id);
    saveCanvas(saved);
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    const original = getPanels(readCanvas());
    for (const [index, title] of ["后续接口接入计划", "待开始的会话"].entries()) {
      document.querySelectorAll<HTMLElement>(".flexlayout__tabset").forEach((pane, i) => {
        pane.getBoundingClientRect = () => new DOMRect(i * 564, 0, 556, 700);
        required(pane.querySelector<HTMLElement>(".flexlayout__tabset_tabbar_outer")).getBoundingClientRect = () => new DOMRect(i * 564, 0, 556, 40);
      });
      const y = destination === "title" ? 20 : 500;
      const store = vi.spyOn(Storage.prototype, "setItem");
      store.mockClear();
      pointer(await screen.findByRole("button", { name: title }), "pointerdown", -100, 200);
      pointer(document, "pointermove", 400, y);
      expect(document.querySelector<HTMLElement>(".canvas-drop-preview")?.hidden).toBe(destination === "title");
      expect(store.mock.calls.filter(([key]) => key === canvasStorageKey)).toHaveLength(0);
      pointer(document, "pointerup", 400, y);
      await screen.findByRole("region", { name: title });
      expect(getPanels(readCanvas())).toHaveLength(5 + index);
      expect(getPanels(readCanvas())).toEqual(expect.arrayContaining(original));
      expect(getTabsets(readCanvas())).toHaveLength(destination === "title" ? 2 : 3 + index);
      expect(document.querySelectorAll(".session-canvas-panel")).toHaveLength(destination === "title" ? 2 : 3 + index);
    }
    if (destination === "body") {
      const target = required(document.querySelector<HTMLElement>(".flexlayout__tabset"));
      target.getBoundingClientRect = () => new DOMRect(0, 0, 556, 700);
      required(target.querySelector<HTMLElement>(".flexlayout__tabset_tabbar_outer")).getBoundingClientRect = () => new DOMRect(0, 0, 556, 40);
      pointer(screen.getByRole("button", { name: "整理导航交互" }), "pointerdown", -100, 200);
      pointer(document, "pointermove", 400, 500);
      pointer(document, "pointerup", 400, 500);
      await screen.findByRole("region", { name: "整理导航交互" });
      expect(getTabsets(readCanvas())).toHaveLength(5);
      expect(getPanels(readCanvas())).toHaveLength(6);
    }
    await waitFor(() => {
      const detailStreams = [...api.streams.entries()].filter(([path]) => path.startsWith("/api/sessions/")).reduce((sum, [, streams]) => sum + streams.size, 0);
      expect(detailStreams).toBe(destination === "title" ? 2 : 5);
    });
  });

  it("splits on body drops and merges on title drops without duplicating the open session", async () => {
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    await addSecond();
    const before = getPanels(readCanvas());
    const destinationId = before.find(panel => panel.sessionId === "project-notes")?.panelId;
    function measurePanes() {
      document.querySelectorAll<HTMLElement>(".flexlayout__tabset").forEach(pane => {
        const x = pane.querySelector<HTMLElement>("[data-canvas-tab]")?.dataset.canvasTab === destinationId ? 0 : 564;
        // Shadow the shared prototype mock so measuring a tab cannot change
        // every element's geometry, including the canvas itself.
        pane.getBoundingClientRect = () => new DOMRect(x, 0, 556, 700);
        const bar = pane.querySelector<HTMLElement>(".flexlayout__tabset_tabbar_outer");
        if (!bar) throw new Error("Missing title bar");
        bar.getBoundingClientRect = () => new DOMRect(x, 0, 556, 40);
        pane.querySelectorAll<HTMLElement>("[role=tab]").forEach((tab, i) => {
          tab.getBoundingClientRect = () => new DOMRect(x + i * 180, 0, 180, 40);
        });
      });
    }
    measurePanes();
    const entry = screen.getByRole("button", { name: "搭建前端工作区" });
    const store = vi.spyOn(Storage.prototype, "setItem");
    pointer(entry, "pointerdown", 40, 100);
    pointer(document, "pointermove", 180, 350);
    expect(document.querySelector(".canvas-drag-ghost")?.textContent).toBe("搭建前端工作区");
    expect(store.mock.calls.filter(([key]) => key === canvasStorageKey)).toHaveLength(0);
    pointer(document, "pointerup", 180, 350);
    await waitFor(() => expect(store.mock.calls.filter(([key]) => key === canvasStorageKey)).toHaveLength(1));
    await waitFor(() => expect(getTabsets(readCanvas())).toHaveLength(2));
    expect(getTabsets(readCanvas()).every(group => group.getTabNodes().length === 1)).toBe(true);
    expect(getPanels(readCanvas())).toEqual(expect.arrayContaining(before));
    measurePanes();
    pointer(screen.getByRole("button", { name: "搭建前端工作区" }), "pointerdown", 40, 100);
    pointer(document, "pointermove", 400, 20);
    pointer(document, "pointerup", 400, 20);
    await waitFor(() => expect(getTabsets(readCanvas())).toHaveLength(1));
    expect(getPanels(readCanvas())).toEqual(expect.arrayContaining(before));
    expect(getPanels(readCanvas())).toHaveLength(before.length);
    expect(sessionIdOf(required(focusedTab(readCanvas())))).toBe("workspace-layout");
    expect(document.querySelector(".canvas-drag-layer")).toBeNull();
  });

  it.each([700, 480])("keeps sidebar dragging and body splitting available at a %ipx viewport", async viewport => {
    vi.stubGlobal("innerWidth", viewport);
    const width = viewport - 200;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, 700));
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state")).toBe("expanded");
    const pane = required(document.querySelector<HTMLElement>(".flexlayout__tabset"));
    const bar = required(pane.querySelector<HTMLElement>(".flexlayout__tabset_tabbar_outer"));
    bar.getBoundingClientRect = () => new DOMRect(0, 0, width, 40);
    const entry = screen.getByRole("button", { name: "搭建前端工作区" });
    const initialPanel = required(getPanels(readCanvas())[0]);
    pointer(entry, "pointerdown", -80, 150);
    pointer(document, "pointermove", width / 2, 560);
    const preview = required(document.querySelector<HTMLElement>(".canvas-drop-preview"));
    expect(preview.hidden).toBe(false);
    expect(preview.style.height).toBe("346px");
    expect(getPanels(readCanvas())).toHaveLength(1);
    pointer(document, "pointerup", width / 2, 560);
    await waitFor(() => expect(document.querySelectorAll(".session-canvas-panel")).toHaveLength(2));
    expect(getPanels(readCanvas())).toContainEqual(initialPanel);
    expect(getTabsets(readCanvas())).toHaveLength(2);
    expect(document.querySelector(".canvas-compact-tabbar")).toBeNull();
    expect(screen.getByRole("button", { name: "搭建前端工作区" })).toBeTruthy();
  });

  it("returns to a new conversation after the last tab closes, without a canvas placeholder", async () => {
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    expect(document.getElementById("session-title")).toBeNull();
    expect(screen.queryByText("多会话画布")).toBeNull();
    fireEvent.click(within(screen.getByRole("tab", { name: /项目说明与约定/ })).getByTitle("关闭面板"));
    await screen.findByRole("region", { name: "新会话" });
    expect(editor("新会话").textContent?.trim()).toBe("");
    expect(screen.queryByText("把会话放在一起")).toBeNull();
    expect(screen.queryByRole("button", { name: "添加当前会话" })).toBeNull();
    // Closing a blank tab can reuse its draft ID without leaving the view empty.
    fireEvent.click(within(screen.getByRole("tab", { name: /新会话/ })).getByTitle("关闭面板"));
    await screen.findByRole("region", { name: "新会话" });
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(api.fetch.mock.calls.filter(([url, init]) => url === "/api/sessions" && init.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    await screen.findByRole("region", { name: "搭建前端工作区" });
    expect(getPanels(readCanvas()).map(panel => panel.sessionId)).toEqual(["workspace-layout"]);
    expect(api.views.has("project-notes")).toBe(true);
  });

  it("keeps an unsent draft when the last tab closes and opens a fresh composer", async () => {
    window.history.replaceState(null, "", "/");
    renderCanvas();
    await screen.findByRole("region", { name: "新会话" });
    replaceDraft(editor("新会话"), "关闭后仍然保留的草稿");
    fireEvent.click(within(screen.getByRole("tab", { name: /新会话/ })).getByTitle("关闭面板"));
    await waitFor(() => expect(editor("新会话").textContent?.trim()).toBe(""));
    fireEvent.click(screen.getByRole("button", { name: "新会话" }));
    await waitFor(() => expect(editor("新会话").textContent).toContain("关闭后仍然保留的草稿"));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(api.fetch.mock.calls.filter(([url, init]) => url === "/api/sessions" && init.method === "POST")).toHaveLength(0);
  });

  it("is opt in, searchable in settings, and persists the switch", async () => {
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("heading", { name: "项目说明与约定" });
    expect(document.querySelector(".session-canvas")).toBeNull();
    expect(screen.queryByRole("button", { name: "添加到画布" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const toggle = await screen.findByRole("switch", { name: "多会话画布" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "canvas" } });
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(toggle);
    expect(JSON.parse(localStorage.getItem(experimentsStorageKey) ?? "{}").sessionCanvas).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    await waitFor(() => expect(document.querySelectorAll(".session-canvas-panel")).toHaveLength(1));
  });

  it("isolates drafts and sends, shares streams, and releases panels when disabled", async () => {
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    await addSecond();
    replaceDraft(editor("项目说明与约定"), "只发送到第一条会话");
    replaceDraft(editor("搭建前端工作区"), "保留第二条草稿");
    // The second panel stays selected while the first panel submits.
    fireEvent.click(within(panel("项目说明与约定")).getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(api.view("project-notes").state.messages.some(message => message.text === "只发送到第一条会话")).toBe(true));
    expect(api.view("workspace-layout").state.messages.some(message => message.text === "只发送到第一条会话")).toBe(false);
    expect(editor("搭建前端工作区").textContent).toContain("保留第二条草稿");
    expect(api.streams.get("/api/events")?.size).toBe(1);
    expect(api.streams.get("/api/sessions/project-notes/events")?.size).toBe(1);
    expect(api.fetch.mock.calls.filter(([url]) => url === "/api/sessions/project-notes/events")).toHaveLength(1);
    fireEvent.focus(editor("搭建前端工作区"));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const toggle = await screen.findByRole("switch", { name: "多会话画布" });
    fireEvent.click(toggle);
    await waitFor(() => expect(api.streams.get("/api/sessions/project-notes/events")?.size).toBe(0));
    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toContain("保留第二条草稿"));
    expect(document.querySelector(".session-canvas")).toBeNull();
    expect(api.view("project-notes").state.busy).toBe(true);
    expect(api.fetch.mock.calls.some(([url, init]) => url.endsWith("/cancel") || init.method === "DELETE")).toBe(false);
  });

  it("keeps a stable panel through first send and does not create the session twice", async () => {
    window.history.replaceState(null, "", "/");
    renderCanvas();
    await screen.findByRole("region", { name: "新会话" });
    const handleId = screen.getByRole("tab", { name: /新会话/ }).id;
    replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "创建一次");
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(api.fetch.mock.calls.filter(([url, init]) => url === "/api/sessions" && init.method === "POST")).toHaveLength(1));
    await waitFor(() => expect(getPanels(readCanvas())[0]?.sessionId).not.toContain("local-"));
    expect(document.getElementById(handleId)).toBeTruthy();
    expect(document.querySelectorAll(".session-canvas-panel")).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: "在 默认工作区 中新建会话" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent?.trim()).toBe(""));
    replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "第二条独立草稿");
    await addSecond();
    expect(editor("新会话").textContent).toContain("第二条独立草稿");
    expect(api.fetch.mock.calls.filter(([url, init]) => url === "/api/sessions" && init.method === "POST")).toHaveLength(1);
  });

  it("removes every panel owned by a deleted workspace while keeping other workspaces open", async () => {
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    await addSecond();
    replaceDraft(editor("搭建前端工作区"), "此工作区的未发送草稿");
    fireEvent.keyDown(screen.getByRole("button", { name: "alphacode-web 的工作区操作" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除工作区" }));
    const dialog = await screen.findByRole("alertdialog", { name: "删除工作区“alphacode-web”？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除工作区" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(screen.queryByRole("region", { name: "搭建前端工作区" })).toBeNull());
    expect(screen.getByRole("region", { name: "项目说明与约定" })).toBeTruthy();
    expect(getPanels(readCanvas()).some(panel => panel.sessionId === "workspace-layout")).toBe(false);
    expect(api.views.has("workspace-layout")).toBe(true);
    await waitFor(() => expect(api.streams.get("/api/sessions/workspace-layout/events")?.size).toBe(0));
  });

  it("preserves canvas geometry on focus and closes panels without deleting sessions", async () => {
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    await addSecond();
    const before = readCanvas();
    fireEvent.focus(editor("项目说明与约定"));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("session")).toBe("project-notes"));
    expect(geometry(readCanvas())).toEqual(geometry(before));
    fireEvent.click(within(screen.getByRole("tab", { name: /搭建前端工作区/ })).getByTitle("关闭面板"));
    await waitFor(() => expect(api.streams.get("/api/sessions/workspace-layout/events")?.size).toBe(0));
    expect(api.views.has("workspace-layout")).toBe(true);
    expect(getPanels(readCanvas())).toHaveLength(1);
  });

  it("resizes without rebuilding messages or persisting intermediate proportions", async () => {
    const models = vi.spyOn(Model, "fromJson");
    const history = vi.spyOn(historyBuilder, "buildSessionHistory");
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    await addSecond();
    await within(panel("项目说明与约定")).findByRole("heading", { name: "开发约定" });
    await within(panel("搭建前端工作区")).findByRole("heading", { name: "一个简单、专注的工作区" });
    const model = models.mock.results[0]?.value as Model;
    const rowId = required(model.getRootRow()).getId();
    const store = vi.spyOn(Storage.prototype, "setItem");
    history.mockClear();
    act(() => {
      model.doAction(Actions.adjustWeights(rowId, [60, 40]).setAdjusting(true));
      model.doAction(Actions.adjustWeights(rowId, [65, 35]).setAdjusting(true));
    });
    expect(store.mock.calls.filter(([key]) => key === canvasStorageKey)).toHaveLength(0);
    act(() => { model.doAction(Actions.adjustWeights(rowId, [65, 35])); });
    expect(store.mock.calls.filter(([key]) => key === canvasStorageKey)).toHaveLength(1);
    expect(history).not.toHaveBeenCalled();
    expect(readCanvas().getRootRow()?.getChildren().map(node => node.getAttributeOwn("weight"))).toEqual([65, 35]);
  });

  it("preserves uncertain request identity after switching back to a single conversation", async () => {
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    await waitFor(() => expect(api.streams.get("/api/sessions/project-notes/events")?.size).toBe(1));
    api.overrides.set("/api/sessions/project-notes/requests", () => { throw new TypeError("offline"); });
    replaceDraft(editor("项目说明与约定"), "请求结果未知");
    fireEvent.click(within(panel("项目说明与约定")).getByRole("button", { name: "发送消息" }));
    await screen.findByRole("button", { name: "重试发送" });
    const request = api.fetch.mock.calls.find(([url]) => url.endsWith("/requests"));
    const requestId = JSON.parse(String(request?.[1].body)).requestId;
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(await screen.findByRole("switch", { name: "多会话画布" }));
    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    const retry = await screen.findByRole("button", { name: "重试发送" });
    api.overrides.delete("/api/sessions/project-notes/requests");
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(retry);
    await waitFor(() => expect(api.fetch.mock.calls.filter(([url]) => url.endsWith("/requests"))).toHaveLength(2));
    const retried = api.fetch.mock.calls.filter(([url]) => url.endsWith("/requests"))[1];
    expect(JSON.parse(String(retried?.[1].body)).requestId).toBe(requestId);
  });

  it("collapses into titles, restores drafts and proportions, and supports collapsing a maximized group", async () => {
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    await addSecond();
    replaceDraft(editor("项目说明与约定"), "保留隐藏草稿");
    const before = geometry(readCanvas());
    const group = () => required(screen.getByRole("tab", { name: /项目说明与约定/ }).closest<HTMLElement>(".flexlayout__tabset"));
    expect(screen.queryByRole("button", { name: "面板选项" })).toBeNull();
    fireEvent.click(within(group()).getByRole("button", { name: "折叠" }));
    await waitFor(() => expect(document.querySelectorAll(".session-canvas-panel")).toHaveLength(1));
    await waitFor(() => expect(api.streams.get("/api/sessions/project-notes/events")?.size).toBe(0));
    expect(getTabsets(readCanvas()).filter(isCollapsed)).toHaveLength(1);
    expect(document.querySelector(".canvas-tabbar-vertical")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "展开：项目说明与约定" }));
    await waitFor(() => expect(editor("项目说明与约定").textContent).toContain("保留隐藏草稿"));
    await waitFor(() => expect(document.querySelectorAll(".session-canvas-panel")).toHaveLength(2));
    expect(geometry(readCanvas())).toEqual(before);
    fireEvent.click(within(group()).getByRole("button", { name: "放大" }));
    await screen.findByRole("button", { name: "还原" });
    fireEvent.click(within(group()).getByRole("button", { name: "折叠" }));
    await screen.findByRole("button", { name: "展开：项目说明与约定" });
    expect(screen.queryByRole("button", { name: "还原" })).toBeNull();
    await screen.findByRole("region", { name: "搭建前端工作区" });
    fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
    await waitFor(() => expect(editor("项目说明与约定").textContent).toContain("保留隐藏草稿"));
    expect(geometry(readCanvas())).toEqual(before);
  });

  it("keeps only the horizontal title when the sole group is collapsed", async () => {
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    const before = getPanels(readCanvas());
    fireEvent.click(screen.getByRole("button", { name: "折叠" }));
    await screen.findByRole("button", { name: "展开：项目说明与约定" });
    expect(document.querySelectorAll(".session-canvas-panel")).toHaveLength(0);
    expect(document.querySelector(".canvas-tabbar-horizontal")).toBeTruthy();
    expect(getPanels(readCanvas())).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "展开：项目说明与约定" }));
    await screen.findByRole("region", { name: "项目说明与约定" });
  });

  it("drags the collapsed separator open, keeping drafts and saving only the final size", async () => {
    renderCanvas();
    await screen.findByRole("region", { name: "项目说明与约定" });
    await addSecond();
    replaceDraft(editor("项目说明与约定"), "拖开后保留草稿");
    const group = required(screen.getByRole("tab", { name: /项目说明与约定/ }).closest<HTMLElement>(".flexlayout__tabset"));
    fireEvent.click(within(group).getByRole("button", { name: "折叠" }));
    await screen.findByRole("button", { name: "展开：项目说明与约定" });
    const splitter = screen.getByRole("separator", { name: "调整面板大小" });
    const before = required(splitter.previousElementSibling) as HTMLElement;
    const after = required(splitter.nextElementSibling) as HTMLElement;
    before.getBoundingClientRect = () => new DOMRect(0, 0, 44, 700);
    after.getBoundingClientRect = () => new DOMRect(52, 0, 1068, 700);
    const store = vi.spyOn(Storage.prototype, "setItem");
    pointer(splitter, "pointerdown", 48, 300);
    pointer(document, "pointermove", 400, 300);
    await waitFor(() => expect(editor("项目说明与约定").textContent).toContain("拖开后保留草稿"));
    expect(store.mock.calls.filter(([key]) => key === canvasStorageKey)).toHaveLength(0);
    pointer(document, "pointerup", 400, 300);
    await waitFor(() => expect(store.mock.calls.filter(([key]) => key === canvasStorageKey)).toHaveLength(1));
    expect(getTabsets(readCanvas()).some(isCollapsed)).toBe(false);
    expect(getTabsets(readCanvas())[0]?.getWeight()).toBeCloseTo(396 / 1112 * 100);
  });

  it("keeps saved panes and drafts mounted when the viewport narrows and widens", async () => {
    const saved = emptyCanvas();
    addPanel(saved, "project-notes");
    addPanel(saved, "workspace-layout");
    saved.doAction(Actions.adjustWeights(required(saved.getRootRow()).getId(), [65, 35]));
    saveCanvas(saved);
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
    renderCanvas();
    await screen.findByRole("region", { name: "搭建前端工作区" });
    expect(document.querySelectorAll(".session-canvas-panel")).toHaveLength(2);
    expect(document.querySelector<HTMLElement>(".canvas-layout-surface")?.style.minWidth).toBe("448px");
    expect(geometry(readCanvas())).toEqual(geometry(saved));
    const originalEditor = editor("项目说明与约定");
    replaceDraft(originalEditor, "缩小和放大窗口都保留");
    const originalPanes = [...document.querySelectorAll(".session-canvas-panel")];
    const store = vi.spyOn(Storage.prototype, "setItem");
    for (const next of [1120, 320, 700]) {
      width.mockReturnValue(next);
      fireEvent(window, new Event("resize"));
      expect([...document.querySelectorAll(".session-canvas-panel")]).toEqual(originalPanes);
      expect(editor("项目说明与约定")).toBe(originalEditor);
      expect(originalEditor.textContent).toContain("缩小和放大窗口都保留");
    }
    await waitFor(() => expect(api.streams.get("/api/sessions/workspace-layout/events")?.size).toBe(1));
    expect(api.streams.get("/api/sessions/project-notes/events")?.size).toBe(1);
    expect(store.mock.calls.filter(([key]) => key === canvasStorageKey)).toHaveLength(0);
    expect(geometry(readCanvas())).toEqual(geometry(saved));
  });
});

it("migrates grid sessions without capping tabs and excludes draft content and untrusted options", () => {
  localStorage.setItem(legacyCanvasStorageKey, JSON.stringify({ version: 1, panels: [
    { panelId: "old-a", sessionId: "a" }, { panelId: "old-b", sessionId: "b" }, { panelId: "draft", sessionId: "local-unsent" },
  ], focusedPanelId: "old-a", layout: [] }));
  const state = readCanvas();
  expect(getPanels(state).map(panel => panel.sessionId)).toEqual(["a", "b"]);
  expect(sessionIdOf(required(focusedTab(state)))).toBe("a");
  for (const id of ["c", "d", "e"]) addPanel(state, id, "private title");
  expect(getPanels(state)).toHaveLength(5);
  addPanel(state, "b");
  expect(getPanels(state)).toHaveLength(5);
  state.doAction(Actions.updateNodeAttributes(required(getPanels(state)[0]).panelId, { config: { sessionId: "local-unsent", draft: "private draft" } }));
  saveCanvas(state);
  expect(getPanels(readCanvas())).toHaveLength(4);
  expect(localStorage.getItem(canvasStorageKey)).not.toMatch(/private|local-unsent/);
  const stored = JSON.parse(required(localStorage.getItem(canvasStorageKey)));
  stored.layout.children[0].weight = -100;
  stored.layout.children[0].enableClose = false;
  localStorage.setItem(canvasStorageKey, JSON.stringify(stored));
  expect(readCanvas().getRootRow()?.getChildren()[0]?.getAttributeOwn("weight")).toBeGreaterThan(0);
  expect(readCanvas().getRootRow()?.getChildren()[0]?.getAttributeOwn("enableClose")).not.toBe(false);
  localStorage.setItem(canvasStorageKey, "{broken");
  expect(getPanels(readCanvas())).toHaveLength(0);
});

it("preserves dock structure, tab selection and proportions through storage", () => {
  const model = emptyCanvas();
  addPanel(model, "a");
  addPanel(model, "b");
  const c = required(addPanel(model, "c"));
  const target = required(getTabsets(model)[0]);
  model.doAction(Actions.moveNode(c, target.getId(), DockLocation.BOTTOM, -1, true));
  model.doAction(Actions.adjustWeights(required(model.getRootRow()).getId(), [60, 40]));
  saveCanvas(model);
  expect(geometry(readCanvas())).toEqual(geometry(model));
  expect(sessionIdOf(required(focusedTab(readCanvas())))).toBe("c");
});

it("persists all tabs and regions beyond the former storage limits", () => {
  const model = Model.fromJson({ layout: { type: "row", children: Array.from({ length: 45 }, (_, group) => ({
    type: "tabset", children: Array.from({ length: group === 0 ? 20 : 1 }, (_, tab) => ({
      type: "tab", id: `panel-${group}-${tab}`, component: "session", config: { sessionId: `session-${group}-${tab}` },
    })),
  })) } });
  expect(saveCanvas(model)).toBe(true);
  const restored = readCanvas();
  expect(getTabsets(restored)).toHaveLength(45);
  expect(getPanels(restored)).toEqual(getPanels(model));
  expect(geometry(restored)).toEqual(geometry(model));
});

it("preserves deeply nested split layouts", () => {
  const model = emptyCanvas();
  addPanel(model, "root");
  for (let index = 0; index < 14; index++) {
    const target = required(focusedTab(model)).getParent();
    const id = required(addPanel(model, `nested-${index}`));
    model.doAction(Actions.moveNode(id, required(target).getId(), index % 2 ? DockLocation.RIGHT : DockLocation.BOTTOM, -1, true));
  }
  saveCanvas(model);
  expect(getPanels(readCanvas())).toEqual(getPanels(model));
  expect(geometry(readCanvas())).toEqual(geometry(model));
});

it("persists collapsed groups and restores their original dock proportions", () => {
  const model = emptyCanvas();
  const a = required(addPanel(model, "a"));
  addPanel(model, "b");
  const group = required(getTabsets(model)[0]);
  const before = geometry(model);
  collapseGroup(group);
  expect(collapseAxis(group)).toBe("vertical");
  expect(minimumSize(group)).toEqual({ width: 44, height: 42 });
  saveCanvas(model);
  const restored = readCanvas();
  const collapsed = required(getTabsets(restored).find(isCollapsed));
  expect(collapsed.getAttrMaxWidth()).toBe(44);
  focusPanel(restored, a);
  expect(getTabsets(restored).some(isCollapsed)).toBe(false);
  expect(geometry(restored)).toEqual(before);
  const other = required(getTabsets(restored).find(node => node !== collapsed));
  restored.doAction(Actions.moveNode(a, other.getId(), DockLocation.BOTTOM, -1, true));
  const stacked = required(focusedTab(restored)).getParent();
  if (!stacked || stacked.getType() !== "tabset") throw new Error("Missing stacked group");
  const target = required(getTabsets(restored).find(node => node === stacked));
  collapseGroup(target);
  expect(collapseAxis(target)).toBe("horizontal");
  expect(target.getAttrMaxHeight()).toBe(2);
});

function geometry(model: Model) {
  const result: { id: string; weight: unknown; children: string[] }[] = [];
  model.visitNodes(node => {
    if (node.getType() !== "tab") result.push({ id: node.getId(), weight: node.getAttributeOwn("weight"), children: node.getChildren().map(child => child.getId()) });
  });
  return result;
}

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("Expected fixture value");
  return value;
}
