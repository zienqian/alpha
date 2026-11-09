import { describe, expect, it, vi } from "vitest";
import { getSession } from "@/features/sessions/api";
import { groupSessions } from "@/features/sessions/types";

describe("session API boundary", () => {
  it("encodes session IDs as a single path segment", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetch);
    await getSession("a/b?#汉字", new AbortController().signal);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/sessions/a%2Fb%3F%23%E6%B1%89%E5%AD%97");
  });

  it("groups by project identity, supports Windows paths and sorts the latest sessions first", () => {
    const folders = groupSessions([
      { id: "old", projectId: "one", workspaceRoot: "C:\\work\\alpha\\", title: "", updatedAt: "2026-11-01T00:00:00Z", status: "ready" },
      { id: "other", projectId: "two", workspaceRoot: "/other/alpha/", title: "Other", updatedAt: "2026-11-08T00:00:00Z", status: "ready" },
      { id: "new", projectId: "one", workspaceRoot: "C:\\work\\alpha\\", title: "New", updatedAt: "2026-11-09T00:00:00Z", status: "ready" },
    ]);
    expect(folders.map((folder) => [folder.id, folder.name])).toEqual([["one", "alpha"], ["two", "alpha"]]);
    expect(folders[0]?.sessions.map((session) => session.id)).toEqual(["new", "old"]);
    expect(folders[0]?.sessions[1]?.title).toBe("");
  });
});
