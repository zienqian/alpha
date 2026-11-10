import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "./render";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SkillsMarket } from "@/features/skills/skills-market";
import { skillUploadLimit, type SkillCatalog } from "@/features/skills/api";
import { mockSessionApi } from "./fixtures/session-api";

function fixture(): SkillCatalog {
  return { projectId: "alpha", projects: [{ id: "alpha", path: "C:/work/alpha" }, { id: "beta", path: "C:/work/beta" }],
    directories: [{ id: "user-local", path: "C:/user/.alphacode/skills", kind: "local", source: "user", enabled: true, trusted: true, exists: true },
      { id: "project-shared", path: "C:/work/alpha/.agents/skills", kind: "shared", source: "project", enabled: true, trusted: false, exists: true }],
    skills: [
      { name: "code-review", description: "检查代码的正确性", filePath: "C:/user/.alphacode/skills/code-review/SKILL.md", directoryId: "user-local", kind: "local", source: "user", status: "available", userInvocable: true, disableModelInvocation: false },
      { name: "team-style", description: "团队共享写作约定", filePath: "C:/work/alpha/.agents/skills/team-style/SKILL.md", directoryId: "project-shared", kind: "shared", source: "project", status: "untrusted", userInvocable: false, disableModelInvocation: false },
    ], diagnostics: [] };
}

function setup(data = fixture()) {
  const fetch = vi.fn(async (_path: string, init?: RequestInit) => init?.method === "POST"
    ? Response.json({ installed: ["new-skill"], directory: data.directories[0]?.path, requiresNewSession: true }, { status: 201 }) : Response.json(data));
  vi.stubGlobal("fetch", fetch);
  const back = vi.fn();
  render(<AppProviders><SidebarProvider><SkillsMarket initialProjectId="alpha" onBack={back} /></SidebarProvider></AppProviders>);
  return { fetch, back };
}

describe("Skills marketplace", () => {
  it("lists real sources and statuses, filters and searches, and shows directory paths", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "已安装的 Skills" });
    expect(within(list).getByText("code-review")).toBeTruthy();
    expect(within(list).getByText("未信任")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "共享目录" }));
    expect(screen.queryByText("code-review")).toBeNull();
    expect(screen.getByText("team-style")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "no-match" } });
    expect(screen.getByText("没有匹配的 Skills")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Skills 目录"));
    expect(screen.getByText("C:/work/alpha/.agents/skills")).toBeTruthy();
  });

  it("uploads ZIP to the chosen directory and refreshes after installation", async () => {
    const { fetch } = setup();
    await screen.findByText("code-review");
    fireEvent.click(screen.getByRole("button", { name: "添加 Skill" }));
    const file = new File(["zip fixture"], "review.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("上传 ZIP", { selector: "input" }), { target: { files: [file] } });
    fireEvent.change(screen.getByRole("combobox", { name: "安装位置" }), { target: { value: "project-shared" } });
    expect(screen.getByText(/当前项目尚未受信任/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "安装 Skill" }));
    expect(await screen.findByText("已安装：new-skill")).toBeTruthy();
    expect(fetch.mock.calls.find(([, init]) => init?.method === "POST")).toMatchObject(["/api/skills/install?projectId=alpha&directoryId=project-shared", { body: file, headers: { "Content-Type": "application/zip" } }]);
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2));
  });

  it("submits a skill link and retains the form on a duplicate-name error", async () => {
    const { fetch } = setup();
    await screen.findByText("code-review");
    fetch.mockImplementation(async (_path, init) => init?.method === "POST" ? Response.json({ code: "SKILL_NAME_CONFLICT" }, { status: 409 }) : Response.json(fixture()));
    fireEvent.click(screen.getByRole("button", { name: "添加 Skill" }));
    fireEvent.click(screen.getByRole("button", { name: "通过链接" }));
    const url = "https://skills.sh/owner/repo/review";
    fireEvent.change(screen.getByRole("textbox", { name: "Skill 链接" }), { target: { value: url } });
    fireEvent.click(screen.getByRole("button", { name: "安装 Skill" }));
    expect((await screen.findByRole("alert")).textContent).toContain("同名 Skill");
    expect((screen.getByRole("textbox", { name: "Skill 链接" }) as HTMLInputElement).value).toBe(url);
    expect(fetch.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body).toBe(JSON.stringify({ url }));
  });

  it("rejects oversized uploads before sending and handles service failure with retry", async () => {
    const { fetch } = setup();
    await screen.findByText("code-review");
    fireEvent.click(screen.getByRole("button", { name: "添加 Skill" }));
    const file = new File(["x"], "too-big.zip");
    Object.defineProperty(file, "size", { value: skillUploadLimit + 1 });
    fireEvent.change(screen.getByLabelText("上传 ZIP", { selector: "input" }), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "安装 Skill" }));
    expect((await screen.findByRole("alert")).textContent).toContain("压缩包超出限制");
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fetch.mockResolvedValueOnce(Response.json({ code: "SERVER_ERROR" }, { status: 500 }));
    fireEvent.click(screen.getByRole("button", { name: "刷新 Skills" }));
    await screen.findByRole("button", { name: "重试" });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "重试" })).toBeNull());
  });

  it("handles a server without registered projects", async () => {
    setup({ projects: [], directories: [], skills: [], diagnostics: [] });
    expect(await screen.findByText("请先连接项目")).toBeTruthy();
    expect((screen.getByRole("button", { name: "添加 Skill" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("falls back to an enabled destination when switching project configurations", async () => {
    const { fetch } = setup();
    await screen.findByText("code-review");
    fireEvent.click(screen.getByRole("button", { name: "添加 Skill" }));
    fireEvent.click(screen.getByRole("button", { name: "通过链接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Skill 链接" }), { target: { value: "https://example.com/SKILL.md" } });
    fireEvent.change(screen.getByRole("combobox", { name: "安装位置" }), { target: { value: "project-shared" } });
    const beta = fixture();
    beta.projectId = "beta";
    beta.directories = beta.directories.map(directory => ({ ...directory, enabled: directory.id === "user-local" }));
    fetch.mockImplementation(async (_path, init) => init?.method === "POST"
      ? Response.json({ installed: ["new-skill"], directory: "C:/user/.alphacode/skills", requiresNewSession: true }, { status: 201 }) : Response.json(beta));
    fireEvent.change(screen.getByRole("combobox", { name: "当前项目" }), { target: { value: "beta" } });
    await waitFor(() => expect((screen.getByRole("combobox", { name: "安装位置" }) as HTMLSelectElement).value).toBe("user-local"));
    expect(within(screen.getByRole("form", { name: "添加 Skill" })).getByText("C:/user/.alphacode/skills")).toBeTruthy();
    expect(screen.queryByText(/当前项目尚未受信任/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "安装 Skill" }));
    await screen.findByText("已安装：new-skill");
    expect(fetch.mock.calls.find(([, init]) => init?.method === "POST")?.[0]).toBe("/api/skills/install?projectId=beta&directoryId=user-local");
  });

  it("navigates from the sidebar and preserves the chat draft when returning", async () => {
    const api = mockSessionApi();
    window.history.replaceState(null, "", "/?session=project-notes");
    const projectId = api.view("project-notes").session.projectId;
    api.overrides.set(`/api/skills?projectId=${projectId}`, () => Response.json(fixture()));
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("heading", { name: "项目说明与约定", level: 1 });
    fireEvent.change(screen.getByRole("textbox", { name: "消息草稿" }), { target: { value: "保留我的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "Skills 市场" }));
    await screen.findByRole("heading", { name: "Skills 市场", level: 1 });
    expect(new URL(window.location.href).searchParams.get("view")).toBe("skills");
    fireEvent.click(screen.getByRole("button", { name: "返回会话" }));
    expect((screen.getByRole("textbox", { name: "消息草稿" }) as HTMLTextAreaElement).value).toBe("保留我的草稿");
    expect(new URL(window.location.href).searchParams.has("view")).toBe(false);
  });
});
