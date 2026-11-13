import { replaceDraft } from "./fixtures/draft-editor";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { SessionQueue } from "@/features/sessions/session-queue";
import { mockSessionApi } from "./fixtures/session-api";

let api: ReturnType<typeof mockSessionApi>;
const id = "project-notes", path = `/api/sessions/${id}`;
beforeEach(() => {
  window.history.replaceState(null, "", `/?session=${id}`);
  api = mockSessionApi();
  Object.assign(api.view(id), { requestId: "active" });
  Object.assign(api.view(id).state, { busy: true, canSend: false, canQueue: true, canSteer: true,
    queuedRequests: [{ requestId: "one", input: "第一条消息" }, { requestId: "two", input: "第二条消息" }] });
});
async function open() {
  render(<AppProviders><App /></AppProviders>);
  await screen.findByText("第一条消息");
}
async function edit() {
  fireEvent.keyDown(screen.getByRole("button", { name: "第 1 条排队消息的更多操作" }), { key: "Enter" });
  const menu = await screen.findByRole("menu");
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
  fireEvent.click(within(menu).getByRole("menuitem", { name: "编辑消息" }));
  return await screen.findByRole("textbox", { name: "编辑消息" }) as HTMLTextAreaElement;
}

it("only offers editing in the menu, saves in place, and leaves the composer draft intact", async () => {
  await open();
  const draft = screen.getByRole("textbox", { name: "消息草稿" });
  replaceDraft(draft, "保留草稿");
  const editor = await edit();
  expect(document.activeElement).toBe(editor);
  fireEvent.change(editor, { target: { value: "修改后的消息" } });
  fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
  expect(api.fetch.mock.calls.some(([url]) => url.endsWith("/queue"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("修改后的消息");
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "编辑消息" })).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "第 1 条排队消息的更多操作" }));
  expect(draft.textContent).toBe("保留草稿");
  expect(api.view(id).state.queuedRequests?.map(item => item.requestId)).toEqual(["one", "two"]);
  expect(api.fetch.mock.calls.find(([url]) => url.endsWith("/queue"))?.[1].body).toBe(JSON.stringify({
    action: "edit", requestId: "one", input: "修改后的消息", expectedInput: "第一条消息",
  }));
});

it("preserves edits on save failure and after the original request leaves the queue", async () => {
  await open();
  const editor = await edit();
  fireEvent.change(editor, { target: { value: "尚未保存" } });
  api.overrides.set(`${path}/queue`, () => Response.json({ code: "QUEUE_CONFLICT" }, { status: 409 }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText(/这条排队消息已在另一端修改/);
  expect(editor.value).toBe("尚未保存");
  await act(async () => { api.view(id).state.queuedRequests = []; api.publish(id); });
  expect(await screen.findByText(/这条消息已不在队列中/)).toBeTruthy();
  expect(editor.value).toBe("尚未保存");
  expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("region", { name: "待发送消息" })).toBeNull();
});

it("reorders with the keyboard and steers a specific pending request without cancelling the active one", async () => {
  await open();
  fireEvent.keyDown(screen.getByRole("button", { name: "调整第 2 条排队消息的顺序" }), { key: "ArrowUp" });
  await waitFor(() => expect(api.view(id).state.queuedRequests?.[0]?.requestId).toBe("two"));
  await waitFor(() => expect((screen.getByRole("button", { name: "用第 1 条排队消息引导" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "用第 1 条排队消息引导" }));
  await screen.findByText("引导中…");
  expect(api.view(id).requestId).toBe("active");
  expect(api.fetch.mock.calls.filter(([url]) => url.endsWith("/cancel"))).toHaveLength(0);
  expect(api.fetch.mock.calls.filter(([url]) => url.endsWith("/queue")).map(([, init]) => JSON.parse(String(init.body)))).toEqual([
    { action: "move", requestId: "two", beforeRequestId: "one" }, { action: "steer", requestId: "two" },
  ]);
  expect((screen.getByRole("button", { name: "第 1 条排队消息的更多操作" }) as HTMLButtonElement).disabled).toBe(true);
});

it("reorders a dragged row and restores server order if the mutation fails", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const onMove = vi.fn(async () => false);
  const props = { requests: api.view(id).state.queuedRequests, disabled: false, canSteer: true,
    onRemove: vi.fn(), onEdit: vi.fn(async () => true), onSteer: vi.fn(async () => true), onMove };
  render(<AppProviders><SessionQueue {...props} /></AppProviders>);
  const list = within(screen.getByRole("region", { name: "待发送消息" })).getAllByRole("listitem");
  list.forEach((row, index) => { row.getBoundingClientRect = () => ({ top: index * 40, bottom: (index + 1) * 40 } as DOMRect); });
  const handle = screen.getByRole("button", { name: "调整第 1 条排队消息的顺序" });
  handle.setPointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 20 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 60 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  await waitFor(() => expect(onMove).toHaveBeenCalledExactlyOnceWith("one", null));
  await waitFor(() => expect(within(screen.getByRole("region", { name: "待发送消息" })).getAllByRole("listitem")[0]?.textContent).toContain("第一条消息"));
});
