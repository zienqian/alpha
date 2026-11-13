import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "@/components/providers";
import { clearReloadDrafts, preserveReloadDrafts, readReloadDrafts } from "@/features/sessions/reload-drafts";
import { App } from "@/app";
import { mockSessionApi } from "./fixtures/session-api";

afterEach(() => {
  document.querySelector('meta[name="alphacode-revision"]')?.remove();
  clearReloadDrafts();
});

function pageRevision() {
  const meta = document.createElement("meta");
  meta.name = "alphacode-revision";
  meta.content = "old";
  document.head.append(meta);
}

describe("Server updates", () => {
  it("does not expose update controls or poll server versions", async () => {
    pageRevision();
    window.history.replaceState(null, "", "/");
    const api = mockSessionApi();
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("textbox", { name: "消息草稿" });
    expect(screen.queryByRole("button", { name: /保留草稿并刷新|重试更新/ })).toBeNull();
    expect(api.fetch.mock.calls.some(([path]) => path === "/api/info" || path === "/api/server/update")).toBe(false);
  });

  it("restores text drafts and the selected local conversation after a refresh", async () => {
    window.history.replaceState(null, "", "/");
    mockSessionApi();
    expect(preserveReloadDrafts({ selectedSessionId: "local-kept", localSessions: [{ id: "local-kept", folderId: "web" }],
      drafts: { "local-kept": { text: "正在编辑的文字", attachments: [] }, saved: { text: "其他会话的草稿", attachments: [] } } })).toBe(true);
    expect(readReloadDrafts()?.drafts.saved?.text).toBe("其他会话的草稿");
    render(<AppProviders><App /></AppProviders>);
    const composer = await screen.findByRole("textbox", { name: "消息草稿" });
    expect(composer.textContent).toBe("正在编辑的文字");
    expect(readReloadDrafts()).toBeUndefined();
  });

  it("keeps the page open for file attachments or unavailable storage", () => {
    const value = { selectedSessionId: "local-first", localSessions: [{ id: "local-first" }], drafts: {
      "local-first": { text: "draft", attachments: [{ id: "file", file: new File(["data"], "data.txt") }] },
    } };
    expect(preserveReloadDrafts(value)).toBe(false);
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QUOTA_EXCEEDED"); });
    expect(preserveReloadDrafts({ ...value, drafts: {} })).toBe(false);
    storage.mockRestore();
  });
});
