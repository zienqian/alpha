import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { mockSessionApi } from "./fixtures/session-api";

let api: ReturnType<typeof mockSessionApi>;
const id = "project-notes";
const path = `/api/sessions/${id}`;
beforeEach(() => { window.history.replaceState(null, "", `/?session=${id}`); api = mockSessionApi(); });
async function open() {
  const app = render(<AppProviders><App /></AppProviders>);
  await waitFor(() => expect(api.streams.get(`${path}/events`)?.size).toBe(1));
  return app;
}
const input = () => screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement;
const sends = () => api.fetch.mock.calls.filter(([url]) => url.endsWith("/requests"));

describe("live conversation", () => {
  it("opens an empty /web draft without a sidebar placeholder and sends in the shared CLI session", async () => {
    api.view(id).state.messages = [];
    api.view(id).session.title = "AlphaCode";
    api.infos.splice(0);
    await open();
    expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
    const navigation = screen.getByRole("navigation", { name: "文件夹与会话" });
    expect(within(navigation).queryByRole("button", { name: "AlphaCode" })).toBeNull();
    expect(within(navigation).queryByRole("button", { name: "新会话" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "这个会话还没有消息" })).toBeNull();
    expect(api.fetch.mock.calls.every(([, init]) => (init.method ?? "GET") === "GET")).toBe(true);

    fireEvent.change(input(), { target: { value: "第一条消息" } });
    expect(within(navigation).getByRole("button", { name: "新会话" }).getAttribute("aria-current")).toBe("page");
    expect(api.fetch.mock.calls.every(([, init]) => (init.method ?? "GET") === "GET")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]?.[0]).toBe(`${path}/requests`);
    expect(api.fetch.mock.calls.some(([url, init]) => url === "/api/sessions" && init.method === "POST")).toBe(false);
    expect(await screen.findByText("第一条消息", {}, { timeout: 5000 })).toBeTruthy();
    expect(within(navigation).getByRole("button", { name: "AlphaCode" }).getAttribute("aria-current")).toBe("page");
    expect(within(navigation).queryByRole("button", { name: "新会话" })).toBeNull();
  });

  it("keeps an empty /web project's composer usable after choosing a new draft", async () => {
    api.view(id).state.messages = [];
    api.infos.splice(0);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(screen.queryByRole("button", { name: "新会话" })).toBeNull();
    fireEvent.change(input(), { target: { value: "保留当前项目" } });
    expect((screen.getByRole("button", { name: "发送消息" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "文件夹 docs" })).toBeTruthy();
    expect(api.fetch.mock.calls.every(([, init]) => (init.method ?? "GET") === "GET")).toBe(true);
  });

  it("keeps typed /web drafts selectable across navigation without adding empty placeholders", async () => {
    api.view(id).state.messages = [];
    api.infos.splice(api.infos.findIndex(info => info.id === id), 1);
    await open();
    expect(screen.queryByRole("button", { name: "新会话" })).toBeNull();
    fireEvent.change(input(), { target: { value: "尚未发送的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    await screen.findByRole("heading", { name: "一个简单、专注的工作区" });
    fireEvent.click(screen.getByRole("button", { name: "新会话" }));
    expect(input().value).toBe("尚未发送的草稿");
    expect(new URL(window.location.href).searchParams.get("session")).toBe(id);
    fireEvent.change(input(), { target: { value: "" } });
    expect(screen.queryByRole("button", { name: "新会话" })).toBeNull();
    expect(api.fetch.mock.calls.every(([, init]) => (init.method ?? "GET") === "GET")).toBe(true);
  });

  it("reveals an empty /web conversation when its first message arrives from CLI", async () => {
    api.view(id).state.messages = [];
    api.infos.splice(0);
    await open();
    expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
    await act(async () => {
      api.view(id).state.messages = [{ id: "cli-first", role: "user", text: "从终端开始" }];
      api.publish(id);
    });
    expect(await screen.findByText("从终端开始")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "从这里，开始构建。" })).toBeNull();
    expect(screen.getByRole("button", { name: "项目说明与约定" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "新会话" })).toBeNull();
  });

  it("keeps history retry available if an empty /web draft fails to refresh", async () => {
    api.view(id).state.messages = [];
    api.infos.splice(0);
    await open();
    api.overrides.set(path, () => Response.json({ code: "SESSION_NOT_FOUND" }, { status: 404 }));
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    const retry = await screen.findByRole("button", { name: "重试加载历史" });
    expect(screen.queryByRole("button", { name: "新会话" })).toBeNull();
    api.overrides.delete(path);
    fireEvent.click(retry);
    expect(await screen.findByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
  });

  it("sends once, renders CLI deltas immediately, keeps the next draft, and cancels the shared request", async () => {
    await open();
    fireEvent.change(input(), { target: { value: "你好 server" } });
    const button = screen.getByRole("button", { name: "发送消息" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(sends()).toHaveLength(1));
    await waitFor(() => expect(input().value).toBe(""));
    expect(await screen.findByText("你好 server", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("正在思考")).toBeTruthy();
    const request = JSON.parse(String(sends()[0]?.[1].body));
    expect(request.requestId).toBeTruthy();
    expect(sends()[0]?.[1]).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", headers: { "Content-Type": "application/json" } });
    fireEvent.change(input(), { target: { value: "下一条草稿" } });
    await act(async () => {
      api.view(id).state.messages = [...api.view(id).state.messages, { id: "reply", role: "assistant", text: "**流式", streaming: true }];
      api.publish(id);
    });
    expect(await screen.findByText("正在回复")).toBeTruthy();
    await act(async () => {
      api.view(id).state.messages = api.view(id).state.messages.map(message => message.id === "reply" ? { ...message, text: "**流式回复**" } : message);
      api.publish(id);
    });
    expect(await screen.findByText("流式回复")).toBeTruthy();
    expect(input().value).toBe("下一条草稿");
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    await waitFor(() => expect(api.fetch.mock.calls.find(([url]) => url === `${path}/cancel`)?.[1].body).toBe(JSON.stringify({ requestId: request.requestId })));
    await waitFor(() => expect((screen.getByRole("button", { name: "发送消息" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("creates a real session in the selected project before submitting its first message", async () => {
    window.history.replaceState(null, "", "/");
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("button", { name: "搭建前端工作区" });
    fireEvent.change(input(), { target: { value: "新的任务" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(sends()).toHaveLength(1));
    const createdId = new URL(window.location.href).searchParams.get("session");
    expect(createdId).toBeTruthy();
    expect(createdId).not.toMatch(/^local-/);
    expect(sends()[0]?.[0]).toBe(`/api/sessions/${createdId}/requests`);
    if (!createdId) throw new Error("Missing created session");
    expect(api.view(createdId).session.projectId).toBe(api.info("workspace-layout").projectId);
    expect(await screen.findByText("新的任务")).toBeTruthy();
    await waitFor(() => expect(input().value).toBe(""));
    expect(within(screen.getByRole("navigation", { name: "文件夹与会话" })).getAllByRole("button", { name: "新会话" })).toHaveLength(1);
  });

  it("retries an uncertain submission with exactly the same ID and original input without clearing edited text", async () => {
    await open();
    api.overrides.set(`${path}/requests`, () => { throw new TypeError("connection lost after admission"); });
    fireEvent.change(input(), { target: { value: "原请求" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await screen.findByRole("button", { name: "重试发送" });
    expect(input().value).toBe("原请求");
    fireEvent.change(input(), { target: { value: "保留后续草稿" } });
    api.overrides.delete(`${path}/requests`);
    fireEvent.click(screen.getByRole("button", { name: "重试发送" }));
    await waitFor(() => expect(sends()).toHaveLength(2));
    expect(sends()[1]?.[1].body).toBe(sends()[0]?.[1].body);
    expect(await screen.findByText("原请求")).toBeTruthy();
    expect(input().value).toBe("保留后续草稿");
  });

  it("submits on Enter but not Shift+Enter or IME confirmation", async () => {
    await open();
    fireEvent.change(input(), { target: { value: "中文输入" } });
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    expect(sends()).toHaveLength(0);
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(sends()).toHaveLength(1));
  });

  it("keeps a late send response attached to its original session after navigation", async () => {
    await open();
    let finish!: (response: Response) => void;
    api.overrides.set(`${path}/requests`, () => new Promise(resolve => { finish = resolve; }));
    fireEvent.change(input(), { target: { value: "原会话消息" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    fireEvent.change(input(), { target: { value: "另一会话草稿" } });
    await act(async () => finish(Response.json({ requestId: JSON.parse(String(sends()[0]?.[1].body)).requestId, status: "accepted" })));
    expect(new URL(window.location.href).searchParams.get("session")).toBe("workspace-layout");
    expect(input().value).toBe("另一会话草稿");
    fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
    expect(input().value).toBe("");
  });

  it("disables sending while disconnected and resumes from a full snapshot", async () => {
    await open();
    fireEvent.change(input(), { target: { value: "断线保留草稿" } });
    await act(async () => {
      for (const controller of api.streams.get(`${path}/events`) ?? []) controller.close();
      api.streams.get(`${path}/events`)?.clear();
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "发送消息" }) as HTMLButtonElement).disabled).toBe(true));
    api.view(id).state.messages = [{ id: "during-disconnect", role: "assistant", text: "断线期间完成的回复" }];
    expect(await screen.findByText("断线期间完成的回复", {}, { timeout: 3000 })).toBeTruthy();
    expect(input().value).toBe("断线保留草稿");
    expect((screen.getByRole("button", { name: "发送消息" }) as HTMLButtonElement).disabled).toBe(false);
    expect(api.fetch.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(false);
  });

  it("ignores late GET and older SSE snapshots and releases subscriptions when switching/unmounting", async () => {
    const app = await open();
    let resolve!: (response: Response) => void;
    api.overrides.set(path, () => new Promise(done => { resolve = done; }));
    const old = structuredClone(api.view(id));
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await act(async () => {
      api.view(id).state.messages = [{ id: "new", role: "assistant", text: "最新回复" }];
      api.publish(id);
    });
    await screen.findByText("最新回复");
    await act(async () => { resolve(Response.json(old)); api.emit(`${path}/events`, old); });
    expect(screen.getByText("最新回复")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
    await waitFor(() => expect(api.streams.get(`${path}/events`)?.size).toBe(0));
    await waitFor(() => expect(api.streams.get("/api/sessions/workspace-layout/events")?.size).toBe(1));
    app.unmount();
    await waitFor(() => expect([...api.streams.values()].every(set => set.size === 0)).toBe(true));
  });

  it("shows shared approvals and posts the exact request and approval IDs", async () => {
    await open();
    await act(async () => {
      Object.assign(api.view(id), { requestId: "cli-request", approvalId: "approval-1" });
      Object.assign(api.view(id).state, { busy: true, canSend: false, approval: {
        name: "run_command", preview: { type: "command", shell: "pwsh", cwd: "C:/work", command: "echo hello" },
      } });
      api.publish(id);
    });
    await screen.findByText("echo hello");
    fireEvent.click(screen.getByRole("button", { name: "允许一次" }));
    await waitFor(() => expect(api.fetch.mock.calls.find(([url]) => url === `${path}/approval`)?.[1].body)
      .toBe(JSON.stringify({ requestId: "cli-request", approvalId: "approval-1", allow: true })));
    await waitFor(() => expect(screen.queryByRole("button", { name: "允许一次" })).toBeNull());
  });
});
