import { describe, expect, it, vi } from "vitest";
import { installSkill, listSkills, skillError } from "@/features/skills/api";
import { createI18n, namespaces } from "@/i18n/instance";

describe("Skills API availability", () => {
  it("identifies an older server instead of reporting a network or installation failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "NOT_FOUND" }, { status: 404 })));
    const error = await listSkills("project", new AbortController().signal).catch(error => error);
    expect(error.code).toBe("SKILL_API_UNAVAILABLE");
    const t = createI18n("zh-CN").getFixedT(null, namespaces);
    expect(skillError(t, error)).toContain("当前后端尚不支持技能接口");
    expect(skillError(t, error)).toContain("/web");
    await expect(installSkill({ projectId: "project", directoryId: "user-local", url: "https://example.com/SKILL.md" }))
      .rejects.toMatchObject({ code: "SKILL_API_UNAVAILABLE" });
  });

  it("recognizes a static preview's HTML fallback without masking project or download errors", async () => {
    const fetch = vi.fn(async () => new Response("<!doctype html><title>AlphaCode</title>", { headers: { "Content-Type": "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(listSkills(undefined, new AbortController().signal)).rejects.toMatchObject({ code: "SKILL_API_UNAVAILABLE" });
    fetch.mockResolvedValueOnce(Response.json({ code: "PROJECT_NOT_FOUND" }, { status: 404 }));
    await expect(listSkills("missing", new AbortController().signal)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    fetch.mockResolvedValueOnce(Response.json({ code: "SKILL_DOWNLOAD_FAILED" }, { status: 400 }));
    await expect(installSkill({ projectId: "project", directoryId: "user-local", url: "https://example.com/SKILL.md" }))
      .rejects.toMatchObject({ code: "SKILL_DOWNLOAD_FAILED" });
  });
});
