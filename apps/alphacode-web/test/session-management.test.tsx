import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { mockSessionApi } from "./fixtures/session-api";
import { replaceDraft } from "./fixtures/draft-editor";

const id = "project-notes";
const original = "项目说明与约定";

async function setup() {
  const api = mockSessionApi();
  window.history.replaceState(null, "", `/?session=${id}`);
  render(<AppProviders><App /></AppProviders>);
  await screen.findByRole("heading", { name: original });
  await waitFor(() => expect(api.streams.get(`/api/sessions/${id}/events`)?.size).toBe(1));
  return api;
}

async function menu(title = original) {
  fireEvent.keyDown(screen.getByRole("button", { name: `${title} 的更多操作` }), { key: "Enter" });
  return screen.findByRole("menu");
}

function submitTitle(input: HTMLElement) {
  const form = input.closest("form");
  if (!form) throw new Error("Missing title form");
  fireEvent.submit(form);
}

it("renames from the sidebar, preserves the message draft, and updates the header and search", async () => {
  const api = await setup();
  const draft = screen.getByRole("textbox", { name: "消息草稿" });
  replaceDraft(draft, "未发送消息");
  fireEvent.click(within(await menu()).getByRole("menuitem", { name: "重命名" }));
  const input = await screen.findByRole("textbox", { name: "会话标题" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.change(input, { target: { value: "  新的会话标题 📝  " } });
  submitTitle(input);
  await screen.findByRole("heading", { name: "新的会话标题 📝" });
  expect(api.info(id).title).toBe("新的会话标题 📝");
  expect(draft.textContent).toBe("未发送消息");
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(await screen.findByRole("option", { name: /新的会话标题/ })).toBeTruthy();
});

it("keeps a failed rename editable, rejects blank names, and cancels with Escape", async () => {
  const api = await setup();
  api.overrides.set(`/api/sessions/${id}`, init => init.method === "PATCH"
    ? Response.json({ code: "SERVER_ERROR" }, { status: 500 }) : Response.json(api.view(id)));
  fireEvent.click(within(await menu()).getByRole("menuitem", { name: "重命名" }));
  const input = screen.getByRole("textbox", { name: "会话标题" });
  fireEvent.change(input, { target: { value: " " } });
  expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: "保留编辑" } });
  submitTitle(input);
  expect((await screen.findByRole("alert")).textContent).toContain("编辑内容已保留");
  expect((input as HTMLInputElement).value).toBe("保留编辑");
  expect(screen.getByRole("heading", { name: original })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "会话标题" })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: `${original} 的更多操作` })));
});

it("requires confirmation and removes the active session, URL and draft while keeping its project usable", async () => {
  const api = await setup();
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "即将删除的草稿");
  fireEvent.click(within(await menu()).getByRole("menuitem", { name: "删除会话" }));
  let dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(api.views.has(id)).toBe(true);
  fireEvent.click(within(await menu()).getByRole("menuitem", { name: "删除会话" }));
  dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "删除会话" }));
  await waitFor(() => expect(api.views.has(id)).toBe(false));
  await waitFor(() => expect(screen.queryByRole("button", { name: original })).toBeNull());
  expect(new URL(window.location.href).searchParams.has("session")).toBe(false);
  expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("");
  await waitFor(() => expect(api.streams.get(`/api/sessions/${id}/events`)?.size ?? 0).toBe(0));
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(screen.queryByRole("option", { name: /项目说明与约定/ })).toBeNull();
});

it("keeps failed deletes visible and prevents duplicate requests until a pending delete finishes", async () => {
  const api = await setup();
  let finish!: (response: Response) => void;
  api.overrides.set(`/api/sessions/${id}`, init => init.method === "DELETE"
    ? new Promise(resolve => { finish = resolve; }) : Response.json(api.view(id)));
  fireEvent.click(within(await menu()).getByRole("menuitem", { name: "删除会话" }));
  const dialog = await screen.findByRole("alertdialog");
  const remove = within(dialog).getByRole("button", { name: "删除会话" });
  fireEvent.click(remove); fireEvent.click(remove);
  expect((remove as HTMLButtonElement).disabled).toBe(true);
  expect(api.fetch.mock.calls.filter(([path, init]) => path.endsWith(id) && init.method === "DELETE")).toHaveLength(1);
  await act(async () => finish(Response.json({ code: "SESSION_BUSY" }, { status: 409 })));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("会话正在运行或保存");
  expect(api.views.has(id)).toBe(true);
  expect(new URL(window.location.href).searchParams.get("session")).toBe(id);
});

it("deleting a background session preserves the active selection and message draft", async () => {
  const api = await setup();
  const other = api.infos.find(info => info.id !== id);
  if (!other) throw new Error("Missing background session fixture");
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "保留当前草稿");
  fireEvent.click(within(await menu(other.title)).getByRole("menuitem", { name: "删除会话" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "删除会话" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(new URL(window.location.href).searchParams.get("session")).toBe(id);
  expect(screen.getByRole("textbox", { name: "消息草稿" }).textContent).toBe("保留当前草稿");
  expect(screen.getByRole("heading", { name: original })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: original })));
});

it("applies a renamed local draft when it becomes a saved session and removes its old row", async () => {
  const api = await setup();
  const folderName = api.info(id).workspaceRoot.split(/[\\/]/).at(-1);
  fireEvent.click(screen.getByRole("button", { name: `在 ${folderName} 中新建会话` }));
  replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "第一条消息");
  fireEvent.click(within(await menu("新会话")).getByRole("menuitem", { name: "重命名" }));
  const input = screen.getByRole("textbox", { name: "会话标题" });
  fireEvent.change(input, { target: { value: "草稿自定义标题" } });
  submitTitle(input);
  await screen.findByRole("button", { name: "草稿自定义标题" });
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.fetch.mock.calls.some(([path]) => path.endsWith("/requests"))).toBe(true));
  expect(api.infos.filter(info => info.title === "草稿自定义标题")).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "草稿自定义标题" })).toHaveLength(1);
});
