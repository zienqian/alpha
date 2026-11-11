import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { SessionTitle } from "@/features/sessions/session-title";
import { mockSessionApi } from "./fixtures/session-api";

it("replaces the sidebar skeleton from live title events without disrupting the conversation", async () => {
  const api = mockSessionApi();
  const id = "project-notes";
  window.history.replaceState(null, "", `/?session=${id}`);
  api.info(id).titleStatus = "pending";
  render(<AppProviders><App /></AppProviders>);
  const row = await screen.findByRole("button", { name: "项目说明与约定" });
  await waitFor(() => expect(api.streams.get(`/api/sessions/${id}/events`)?.size).toBe(1));
  expect(row.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  expect(row.getAttribute("aria-current")).toBe("page");
  const input = screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "保留下一条草稿" } });
  await act(async () => {
    Object.assign(api.info(id), { title: "完善项目文档", titleStatus: "ready" });
    api.publish(id);
  });
  const ready = await screen.findByRole("button", { name: "完善项目文档" });
  expect(ready.querySelector('[data-slot="skeleton"]')).toBeNull();
  expect(ready.getAttribute("aria-current")).toBe("page");
  expect(input.value).toBe("保留下一条草稿");
});

it("keeps normal titles visible and caps a stale loading snapshot at eight seconds", () => {
  vi.useFakeTimers();
  try {
    const view = render(<AppProviders><SessionTitle title="" pending /></AppProviders>);
    expect(screen.getByRole("status").textContent).toBe("正在生成标题…");
    act(() => { vi.advanceTimersByTime(8_000); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("新对话")).toBeTruthy();
    view.rerender(<AppProviders><SessionTitle title="已生成标题" pending={false} /></AppProviders>);
    expect(screen.getByText("已生成标题")).toBeTruthy();
  } finally { vi.useRealTimers(); }
});

it("uses the same fallback for untitled saved conversations in the header, sidebar and search", async () => {
  const api = mockSessionApi();
  const id = "project-notes";
  api.info(id).title = " ";
  window.history.replaceState(null, "", `/?session=${id}`);
  render(<AppProviders><App /></AppProviders>);
  expect(await screen.findByRole("heading", { level: 1, name: "新对话" })).toBeTruthy();
  expect((await screen.findByRole("button", { name: "新对话" })).getAttribute("aria-current")).toBe("page");
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(await screen.findByRole("option", { name: /新对话/ })).toBeTruthy();
});
