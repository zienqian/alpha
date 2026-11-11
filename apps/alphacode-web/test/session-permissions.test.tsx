import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { mockSessionApi } from "./fixtures/session-api";

let api: ReturnType<typeof mockSessionApi>;
const id = "project-notes";
const path = `/api/sessions/${id}`;
beforeEach(() => { window.history.replaceState(null, "", `/?session=${id}`); api = mockSessionApi(); });
const input = () => screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement;
const trigger = (name = "请求批准") => screen.getByRole("button", { name: `切换审批模式：${name}` });
const sends = () => api.fetch.mock.calls.filter(([url]) => url.endsWith("/requests"));
async function open() {
  render(<AppProviders><App /></AppProviders>);
  await waitFor(() => expect(api.streams.get(`${path}/events`)?.size).toBe(1));
}
async function choose(name: string, current = "请求批准") {
  fireEvent.keyDown(trigger(current), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(`^${name}`) }));
}

describe("composer approval modes", () => {
  it("saves the selected mode via the real HTTP boundary and follows CLI snapshots", async () => {
    await open();
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect((await screen.findByRole("menuitemradio", { name: /^请求批准/ })).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "了解更多" }));
    expect(screen.getByText(/设置仅对当前会话生效/)).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^完全访问权限/ }));
    await waitFor(() => expect(trigger("完全访问")).toBeTruthy());
    const request = api.fetch.mock.calls.find(([url]) => url === `${path}/permission`);
    expect(request?.[1]).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", body: JSON.stringify({ mode: "full" }) });
    expect(screen.queryByRole("menu")).toBeNull();
    await act(async () => { api.view(id).state.permissionMode = "auto"; api.publish(id); });
    expect(trigger("帮我批准")).toBeTruthy();
    fireEvent.keyDown(trigger("帮我批准"), { key: "Enter" });
    expect((await screen.findByRole("menuitemradio", { name: /^帮我批准/ })).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger("帮我批准")));
  });

  it("blocks sending during a permission save and retains the mode and draft on failure", async () => {
    await open();
    let resolve!: (response: Response) => void;
    api.overrides.set(`${path}/permission`, () => new Promise<Response>(done => { resolve = done; }));
    fireEvent.change(input(), { target: { value: "保留草稿" } });
    await choose("完全访问权限");
    expect((screen.getByRole("button", { name: "正在保存…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "发送消息" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(sends()).toHaveLength(0);
    await act(async () => { resolve(Response.json({ code: "SESSION_BUSY" }, { status: 409 })); });
    expect(await screen.findByText("未能确认权限变更，请检查当前模式后重试。")).toBeTruthy();
    expect(trigger()).toBeTruthy();
    expect(input().value).toBe("保留草稿");
    api.overrides.delete(`${path}/permission`);
    await choose("帮我批准");
    await waitFor(() => expect(trigger("帮我批准")).toBeTruthy());
    expect(screen.queryByText("未能确认权限变更，请检查当前模式后重试。")).toBeNull();
  });

  it.each(["busy", "settingsSaving", "closing"] as const)("disables switching while the server is %s", async state => {
    api.view(id).state[state] = true;
    await open();
    const button = screen.getByRole("button", { name: state === "busy" ? "本次任务结束后可切换审批模式" : state === "settingsSaving" ? "正在保存…" : "会话就绪后可切换审批模式" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(button, { key: "Enter" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps a local draft choice across navigation and applies it before the first send", async () => {
    window.history.replaceState(null, "", "/");
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("button", { name: "继续 搭建前端工作区" });
    fireEvent.change(input(), { target: { value: "以完全访问开始" } });
    await choose("完全访问权限");
    expect(api.fetch.mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
    await waitFor(() => expect(trigger()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "新对话" }));
    expect(trigger("完全访问")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    const mutations = api.fetch.mock.calls.filter(([, init]) => init.method === "POST");
    expect(mutations.map(([url]) => url.split("/").at(-1))).toEqual(["sessions", "permission", "requests"]);
    expect(JSON.parse(String(mutations[1]?.[1].body))).toEqual({ mode: "full" });
    const createdId = new URL(window.location.href).searchParams.get("session");
    if (!createdId) throw new Error("Missing created session");
    expect(api.view(createdId).state.permissionMode).toBe("full");
  });

  it("applies the displayed Ask default even when the server's new-session default is Full", async () => {
    window.history.replaceState(null, "", "/");
    api.view("workspace-layout").state.permissionMode = "full";
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("button", { name: "继续 搭建前端工作区" });
    expect(trigger()).toBeTruthy();
    fireEvent.change(input(), { target: { value: "按当前显示的模式执行" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(sends()).toHaveLength(1));
    const permission = api.fetch.mock.calls.find(([url]) => url.endsWith("/permission"));
    expect(permission?.[1].body).toBe(JSON.stringify({ mode: "ask" }));
  });

  it("does not send the first message if applying the draft's permissions fails", async () => {
    window.history.replaceState(null, "", "/");
    const fetch = api.fetch.getMockImplementation();
    if (!fetch) throw new Error("Missing fetch fixture");
    api.fetch.mockImplementation((url, init) => url.endsWith("/permission")
      ? Promise.resolve(Response.json({ code: "SESSION_BUSY" }, { status: 409 })) : fetch(url, init));
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("button", { name: "继续 搭建前端工作区" });
    await choose("完全访问权限");
    fireEvent.change(input(), { target: { value: "不要直接执行" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(await screen.findByText("未能确认权限变更，请检查当前模式后重试。")).toBeTruthy();
    expect(sends()).toHaveLength(0);
    expect(input().value).toBe("不要直接执行");
    await waitFor(() => expect(trigger()).toBeTruthy());
  });
});
