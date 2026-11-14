import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { CreateProjectDialog } from "@/features/sessions/create-project-dialog";
import { SessionApiError } from "@/features/sessions/api";
import { mockSessionApi } from "./fixtures/session-api";
import { replaceDraft } from "./fixtures/draft-editor";
import { LanguageProvider } from "@/i18n/provider";

async function setup(search = "/") {
  const api = mockSessionApi();
  window.history.replaceState(null, "", search);
  render(<AppProviders><App /></AppProviders>);
  await screen.findByRole("button", { name: "文件夹 alphacode-web" });
  return api;
}

async function openDeleteWorkspace(name: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: `${name} 的工作区操作` }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "删除工作区" }));
  return screen.findByRole("alertdialog", { name: `删除工作区“${name}”？` });
}

it("keeps workspace creation beside its menu and cancels removal without changing anything", async () => {
  const api = await setup();
  const folder = screen.getByRole("button", { name: "文件夹 alphacode-web" });
  const header = folder.parentElement;
  if (!header) throw new Error("Missing workspace header");
  expect(within(header).getByRole("button", { name: "在 alphacode-web 中新建会话" })).toBeTruthy();
  expect(within(header).getByRole("button", { name: "alphacode-web 的工作区操作" })).toBeTruthy();
  const dialog = await openDeleteWorkspace("alphacode-web");
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "alphacode-web 的工作区操作" }));
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  expect(api.fetch.mock.calls.some(([, init]) => init.method === "DELETE")).toBe(false);
});

it("removes the active workspace and its drafts, preserves other workspaces, and restores saved history when re-added", async () => {
  const api = await setup("/?session=workspace-layout");
  await screen.findByRole("heading", { name: "搭建前端工作区", level: 1 });
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "清理此草稿");
  const dialog = await openDeleteWorkspace("alphacode-web");
  fireEvent.click(within(dialog).getByRole("button", { name: "删除工作区" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "文件夹 alphacode-web" })).toBeNull());
  expect(await screen.findByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("");
  expect(screen.getByRole("button", { name: "文件夹 docs" })).toBeTruthy();
  expect(new URL(window.location.href).searchParams.has("session")).toBe(false);
  expect(api.fetch.mock.calls.filter(([, init]) => init.method === "DELETE").map(([path]) => path)).toEqual(["/api/projects/alphacode-web"]);
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
  const create = await screen.findByRole("dialog", { name: "创建项目" });
  fireEvent.change(within(create).getByRole("textbox", { name: "项目名称" }), { target: { value: "恢复工作区" } });
  fireEvent.change(within(create).getByRole("textbox", { name: "源文件夹" }), { target: { value: api.info("workspace-layout").workspaceRoot } });
  fireEvent.click(within(create).getByRole("button", { name: "创建项目" }));
  await screen.findByRole("button", { name: "文件夹 恢复工作区" });
  fireEvent.click(await screen.findByRole("button", { name: "搭建前端工作区" }));
  await screen.findByRole("heading", { name: "搭建前端工作区", level: 1 });
  expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("");
  expect(api.view("workspace-layout").state.messages.length).toBeGreaterThan(0);
});

it("keeps a failed deletion and draft available for retry", async () => {
  const api = await setup("/?session=workspace-layout");
  await screen.findByRole("heading", { name: "搭建前端工作区", level: 1 });
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "失败后保留");
  api.overrides.set("/api/projects/alphacode-web", () => Response.json({ code: "PROJECT_BUSY" }, { status: 409 }));
  const dialog = await openDeleteWorkspace("alphacode-web");
  fireEvent.click(within(dialog).getByRole("button", { name: "删除工作区" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("正在运行或保存");
  expect(screen.getByRole("textbox", { name: "消息草稿", hidden: true }).textContent).toBe("失败后保留");
  api.overrides.delete("/api/projects/alphacode-web");
  fireEvent.click(within(dialog).getByRole("button", { name: "删除工作区" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.queryByRole("button", { name: "文件夹 alphacode-web" })).toBeNull();
});

it("removes an empty workspace and keeps it removed after remounting", async () => {
  const api = mockSessionApi();
  api.projects.push({ projectId: "empty", workspaceRoot: "/projects/empty", name: "空项目" });
  window.history.replaceState(null, "", "/");
  const app = render(<AppProviders><App /></AppProviders>);
  await screen.findByRole("button", { name: "文件夹 空项目" });
  const dialog = await openDeleteWorkspace("空项目");
  fireEvent.click(within(dialog).getByRole("button", { name: "删除工作区" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "文件夹 空项目" })).toBeNull());
  app.unmount();
  render(<AppProviders><App /></AppProviders>);
  await screen.findByRole("button", { name: "文件夹 alphacode-web" });
  expect(screen.queryByRole("button", { name: "文件夹 空项目" })).toBeNull();
});

it("removes a local default workspace draft without calling a remote deletion", async () => {
  const api = await setup();
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "未发送默认草稿");
  const dialog = await openDeleteWorkspace("默认工作区");
  fireEvent.click(within(dialog).getByRole("button", { name: "删除工作区" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("");
  expect(api.fetch.mock.calls.some(([, init]) => init.method === "DELETE")).toBe(false);
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "新的默认草稿");
  expect(await screen.findByRole("button", { name: "文件夹 默认工作区" })).toBeTruthy();
});

it.each([false, true])("sends an unselected chat to the default workspace (empty installation: %s)", async empty => {
  const api = mockSessionApi();
  if (empty) { api.infos.splice(0); api.views.clear(); }
  window.history.replaceState(null, "", "/");
  const app = render(<AppProviders><App /></AppProviders>);
  const picker = await screen.findByRole("button", { name: "更改此聊天的项目" });
  expect(picker.textContent).toBe("默认工作区");
  expect(api.fetch.mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "默认工作区中的任务");
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.fetch.mock.calls.some(([path]) => path.endsWith("/requests"))).toBe(true));
  const request = api.fetch.mock.calls.find(([path, init]) => path === "/api/sessions" && init.method === "POST");
  expect(JSON.parse(String(request?.[1].body))).toEqual({});
  const id = new URL(window.location.href).searchParams.get("session");
  if (!id) throw new Error("Missing created session");
  expect(api.view(id).session.workspaceRoot).toBe("/home/test/.alphacode/workspace");
  expect(api.view(id).state.messages.some(message => message.text === "默认工作区中的任务")).toBe(true);
  expect(await screen.findByRole("button", { name: "文件夹 默认工作区" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "文件夹 workspace" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "在 默认工作区 中新建会话" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "更改此聊天的项目" }), { key: "Enter" });
  expect(await screen.findByRole("menuitem", { name: /默认工作区/ })).toBeTruthy();
  expect(screen.getAllByRole("menuitem", { name: /默认工作区/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("menuitem", { name: /默认工作区/ }));
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "下一条默认草稿");
  expect(screen.getAllByRole("button", { name: "文件夹 默认工作区" })).toHaveLength(1);
  app.unmount();
  window.history.replaceState(null, "", `/?session=${id}`);
  render(<AppProviders><App /></AppProviders>);
  expect(await screen.findByRole("button", { name: "文件夹 默认工作区" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "文件夹 workspace" })).toBeNull();
});

it("keeps default workspace drafts reachable after navigation and allows returning from an explicit project", async () => {
  const api = await setup();
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "保留默认草稿");
  fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
  await screen.findByRole("heading", { name: "项目说明与约定" });
  fireEvent.click(screen.getByRole("button", { name: "新会话" }));
  expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("保留默认草稿");
  fireEvent.keyDown(screen.getByRole("button", { name: "更改此聊天的项目" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /docs/ }));
  fireEvent.keyDown(screen.getByRole("button", { name: "更改此聊天的项目" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "默认工作区" }));
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.fetch.mock.calls.some(([path]) => path.endsWith("/requests"))).toBe(true));
  const request = api.fetch.mock.calls.find(([path, init]) => path === "/api/sessions" && init.method === "POST");
  expect(JSON.parse(String(request?.[1].body))).toEqual({});
});

it("preserves an unselected draft if default workspace creation fails and lets the user retry", async () => {
  const api = await setup();
  api.overrides.set("/api/sessions", init => init.method === "POST"
    ? Response.json({ code: "DIRECTORY_UNAVAILABLE" }, { status: 400 }) : Response.json({ sessions: api.infos }));
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "创建失败后保留");
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("创建失败后保留");
  expect(api.fetch.mock.calls.some(([path]) => path.endsWith("/requests"))).toBe(false);
  api.overrides.delete("/api/sessions");
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.fetch.mock.calls.some(([path]) => path.endsWith("/requests"))).toBe(true));
});

it("moves an unsent draft to the chosen project and sends it using that project's directory", async () => {
  const api = await setup();
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "保留这段草稿");
  const picker = screen.getAllByRole("button", { name: "更改此聊天的项目" }).at(-1);
  if (!picker) throw new Error("Missing project picker");
  fireEvent.keyDown(picker, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /docs/ }));
  expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("保留这段草稿");
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.fetch.mock.calls.some(([path, init]) => path === "/api/sessions" && init.method === "POST"
    && JSON.parse(String(init.body)).projectId === "docs")).toBe(true));
});

it("keeps a saved session in its original project when starting a session in another project", async () => {
  const api = await setup("/?session=project-notes");
  await screen.findByRole("heading", { name: "项目说明与约定" });
  const originalProject = api.view("project-notes").session.projectId;
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "旧会话的草稿");
  fireEvent.click(screen.getByRole("button", { name: "在 alphacode-web 中新建会话" }));
  expect(screen.getByRole("heading", { name: "从这里，开始构建。" })).toBeTruthy();
  expect(api.view("project-notes").session.projectId).toBe(originalProject);
  fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
  await screen.findByRole("heading", { name: "项目说明与约定" });
  expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("旧会话的草稿");
});

it("lists projects with no sessions and creates a named project without creating a remote conversation", async () => {
  const api = mockSessionApi();
  const projects = [{ projectId: "empty", workspaceRoot: "/projects/empty", name: "空项目" }];
  api.overrides.set("/api/projects", init => {
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      const project = { projectId: "new-project", workspaceRoot: body.workspaceRoot, name: body.name };
      projects.push(project); return Response.json({ project }, { status: 201 });
    }
    return Response.json({ projects });
  });
  window.history.replaceState(null, "", "/");
  render(<AppProviders><App /></AppProviders>);
  await screen.findByRole("button", { name: "文件夹 空项目" });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
  const dialog = await screen.findByRole("dialog", { name: "创建项目" });
  const name = within(dialog).getByRole("textbox", { name: "项目名称" });
  expect(document.activeElement).toBe(name);
  fireEvent.change(name, { target: { value: "新项目" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "源文件夹" }), { target: { value: "/projects/new" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "创建项目" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: "文件夹 新项目" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "更改此聊天的项目" }).at(-1)?.textContent).toBe("新项目");
  expect(api.fetch.mock.calls.some(([path, init]) => path === "/api/sessions" && init.method === "POST")).toBe(false);
});

it("retains entered values after an invalid directory and allows correcting and retrying", async () => {
  const create = vi.fn().mockRejectedValueOnce(new SessionApiError(400, "INVALID_DIRECTORY")).mockResolvedValue(undefined);
  const close = vi.fn();
  render(<LanguageProvider initialPreference="zh-CN"><CreateProjectDialog open onOpenChange={close} onCreate={create} /></LanguageProvider>);
  const name = screen.getByRole("textbox", { name: "项目名称" });
  const path = screen.getByRole("textbox", { name: "源文件夹" });
  fireEvent.change(name, { target: { value: "测试" } });
  fireEvent.change(path, { target: { value: "/missing" } });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect((name as HTMLInputElement).value).toBe("测试");
  fireEvent.change(path, { target: { value: "/valid" } });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(create).toHaveBeenLastCalledWith("测试", "/valid");
});

it("uses the native directory picker and treats cancellation as no change", async () => {
  const selectDirectory = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("C:\\work\\project");
  vi.stubGlobal("alphacodeDesktop", { platform: "win32", setAppearance: vi.fn(), selectDirectory });
  const create = vi.fn().mockResolvedValue(undefined);
  render(<LanguageProvider initialPreference="zh-CN"><CreateProjectDialog open onOpenChange={vi.fn()} onCreate={create} /></LanguageProvider>);
  fireEvent.click(screen.getByRole("button", { name: "选择文件夹" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "选择文件夹" }) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole("textbox", { name: "源文件夹" }) as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "选择文件夹" }));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "项目名称" }) as HTMLInputElement).value).toBe("project"));
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith("project", "C:\\work\\project"));
});

it("opens project creation from the mobile drawer and returns focus to navigation on cancel", async () => {
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  try {
    mockSessionApi();
    window.history.replaceState(null, "", "/");
    render(<AppProviders><App /></AppProviders>);
    fireEvent.click(screen.getByRole("button", { name: "切换侧栏" }));
    fireEvent.click(await screen.findByRole("button", { name: "创建项目" }));
    const dialog = await screen.findByRole("dialog", { name: "创建项目" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "关闭侧栏" })).toBeNull());
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "切换侧栏" }));
  } finally { Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth }); }
});
