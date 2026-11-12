import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "@/components/providers";
import { ServerUpdate } from "@/features/sessions/server-update";
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
  it("waits visibly without refreshing a running page", async () => {
    pageRevision();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ managed: true, revision: "old", updateStatus: "pending" })));
    const refresh = vi.fn(() => true);
    render(<AppProviders><ServerUpdate onRefresh={refresh} submitting={false} /></AppProviders>);
    expect(await screen.findByText("发现更新，将在当前任务和保存完成后自动更新后台。")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a refresh after replacement and reports a draft preservation failure", async () => {
    pageRevision();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ managed: true, revision: "new", updateStatus: "current" })));
    const refresh = vi.fn(() => false);
    const view = render(<AppProviders><ServerUpdate onRefresh={refresh} submitting /></AppProviders>);
    const button = await screen.findByRole("button", { name: "保留草稿并刷新" });
    expect(button.hasAttribute("disabled")).toBe(true);
    view.rerender(<AppProviders><ServerUpdate onRefresh={refresh} submitting={false} /></AppProviders>);
    fireEvent.click(button);
    expect(refresh).toHaveBeenCalledOnce();
    expect(await screen.findByText("暂时无法保留草稿。请先移除附件，或复制草稿后手动刷新。")).toBeTruthy();
  });

  it("retries an unsuccessful update through the existing same-origin API", async () => {
    pageRevision();
    const fetch = vi.fn(async () => Response.json({ managed: true, revision: "old", updateStatus: "failed" }));
    vi.stubGlobal("fetch", fetch);
    render(<AppProviders><ServerUpdate onRefresh={() => true} submitting={false} /></AppProviders>);
    fireEvent.click(await screen.findByRole("button", { name: "重试更新" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/server/update", expect.objectContaining({ method: "POST", credentials: "omit" })));
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
