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

it("keeps a saved session in its original project when selecting another project", async () => {
  const api = await setup("/?session=project-notes");
  await screen.findByRole("heading", { name: "项目说明与约定" });
  const originalProject = api.view("project-notes").session.projectId;
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "旧会话的草稿");
  fireEvent.keyDown(screen.getByRole("button", { name: "更改此聊天的项目" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /alphacode-web/ }));
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
