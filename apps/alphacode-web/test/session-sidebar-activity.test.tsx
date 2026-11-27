import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { mockSessionApi } from "./fixtures/session-api";

it("shows live loading, then a completion dot until the task is opened, and resets on the next run", async () => {
  const api = mockSessionApi();
  const id = "project-notes";
  window.history.replaceState(null, "", `/?session=${id}`);
  render(<AppProviders><App /></AppProviders>);
  await screen.findByRole("button", { name: "项目说明与约定" });
  await waitFor(() => expect(api.streams.get(`/api/sessions/${id}/events`)?.size).toBe(1));
  expect(screen.queryByRole("img", { name: "任务已结束，点击查看" })).toBeNull();
  const update = async (status: string) => {
    await act(async () => {
      api.info(id).status = status;
      const current = api.view(id);
      current.state = { ...current.state, busy: status === "running", phase: status === "running" ? "thinking" : "idle" };
      api.publish(id);
    });
  };
  await update("running");
  expect(await screen.findByRole("img", { name: "正在运行…" })).toBeTruthy();
  await update("ready");
  expect(await screen.findByRole("img", { name: "任务已结束，点击查看" })).toBeTruthy();
  expect(screen.queryByRole("img", { name: "正在运行…" })).toBeNull();
  // Closing the project tree must not lose the unread completion.
  const folder = screen.getByRole("button", { name: `文件夹 ${api.info(id).workspaceRoot.split("/").at(-1)}` });
  fireEvent.click(folder);
  fireEvent.click(folder);
  expect(screen.getByRole("img", { name: "任务已结束，点击查看" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "项目说明与约定" }));
  expect(screen.queryByRole("img", { name: "任务已结束，点击查看" })).toBeNull();
  await update("running");
  expect(await screen.findByRole("img", { name: "正在运行…" })).toBeTruthy();
  await update("blocked");
  expect(screen.queryByRole("img", { name: "任务已结束，点击查看" })).toBeNull();
});

it("tracks background tasks from the index without opening their conversation", async () => {
  const api = mockSessionApi();
  window.history.replaceState(null, "", "/?session=project-notes");
  render(<AppProviders><App /></AppProviders>);
  await screen.findByRole("button", { name: "搭建前端工作区" });
  const id = "workspace-layout";
  await act(async () => { api.info(id).status = "running"; api.publish(id); });
  expect(await screen.findByRole("img", { name: "正在运行…" })).toBeTruthy();
  await act(async () => { api.info(id).status = "ready"; api.publish(id); });
  expect(await screen.findByRole("img", { name: "任务已结束，点击查看" })).toBeTruthy();
  expect(api.streams.get(`/api/sessions/${id}/events`)?.size ?? 0).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "搭建前端工作区" }));
  expect(screen.queryByRole("img", { name: "任务已结束，点击查看" })).toBeNull();
});
