import { chooseSelect } from "./select";
import { replaceDraft } from "./fixtures/draft-editor";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "./render";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SkillsMarket } from "@/features/skills/skills-market";
import { skillUploadLimit, type SkillCatalog } from "@/features/skills/api";
import { mockSessionApi } from "./fixtures/session-api";

function fixture(): SkillCatalog {
  return {
    projectId: "alpha",
    projects: [
      { id: "alpha", name: "alpha", path: "C:/work/alpha", trusted: false },
      { id: "beta", name: "beta", path: "C:/work/beta", trusted: true },
    ],
    directories: [
      { id: "user-local", path: "C:/user/.alphacode/skills", kind: "local", source: "user", enabled: true, trusted: true, exists: true },
      { id: "project-shared", path: "C:/work/alpha/.agents/skills", kind: "shared", source: "project", enabled: true, trusted: false, exists: true },
    ],
    skills: [
      { name: "code-review", description: "检查代码的正确性", filePath: "C:/user/.alphacode/skills/code-review/SKILL.md", directoryId: "user-local", kind: "local", source: "user", status: "available", disabledByName: false, userInvocable: true, disableModelInvocation: false },
      { name: "team-style", description: "团队共享写作约定", filePath: "C:/work/alpha/.agents/skills/team-style/SKILL.md", directoryId: "project-shared", kind: "shared", source: "project", status: "untrusted", disabledByName: false, userInvocable: false, disableModelInvocation: false },
    ],
    diagnostics: [],
    settings: { sharedDirectories: true, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
  };
}

function setup(data = fixture()) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Response.json({ installed: ["new-skill"], directory: data.directories[0]?.path, requiresNewSession: true }, { status: 201 });
    }
    if (init?.method === "PATCH") {
      return Response.json({ settings: data.settings, requiresNewSession: true });
    }
    if (init?.method === "DELETE") {
      return Response.json({ removed: "code-review", directory: data.directories[0]?.path, requiresNewSession: true });
    }
    if (path.startsWith("/api/skills/content")) {
      return Response.json({
        name: "code-review",
        filePath: "C:/user/.alphacode/skills/code-review/SKILL.md",
        baseDir: "C:/user/.alphacode/skills/code-review",
        revision: "rev1",
        content: "# Code Review\nCheck edge cases carefully.",
        files: ["references/checklist.md"],
      });
    }
    return Response.json(data);
  });
  vi.stubGlobal("fetch", fetch);
  render(<AppProviders><SidebarProvider><SkillsMarket initialProjectId="alpha" /></SidebarProvider></AppProviders>);
  return { fetch };
}

describe("Skills marketplace", () => {
  it("lists real sources and statuses, filters and searches directly, and shows directory paths in settings dialog", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "本地安装" });
    expect(within(list).getByText("code-review")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "共享目录" })).getByText("不受信任")).toBeTruthy();
    // Project selector and source filters are surfaced directly on the main page.
    expect(screen.getByRole("combobox", { name: "当前项目" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /共享目录/ }));
    expect(screen.queryByText("code-review")).toBeNull();
    expect(screen.getByText("team-style")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索技能" }), { target: { value: "no-match" } });
    expect(screen.getByText("没有匹配的技能")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(screen.getByText("team-style")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /全部/ }));
    expect(screen.getByText("code-review")).toBeTruthy();
    // Open settings dialog to inspect directories.
    fireEvent.click(screen.getByRole("button", { name: "技能设置" }));
    expect(await screen.findByText("C:/work/alpha/.agents/skills")).toBeTruthy();
  });

  it("toggles skills inline, trusts project from banner, previews SKILL.md and uninstalls from detail sheet", async () => {
    const data = fixture();
    const { fetch } = setup(data);
    await screen.findByText("code-review");

    // Inline toggle sends PATCH /api/skills/settings.
    fireEvent.click(screen.getByRole("switch", { name: "启用或禁用 code-review" }));
    await waitFor(() => {
      const patch = fetch.mock.calls.find(([path, init]) => path === "/api/skills/settings" && init?.method === "PATCH");
      expect(patch?.[1]?.body).toBe(JSON.stringify({ toggleSkill: { name: "code-review", enabled: false } }));
    });

    // One-click trust project from the untrusted banner.
    fireEvent.click(screen.getByRole("button", { name: "信任此项目" }));
    await waitFor(() => {
      const patch = fetch.mock.calls.find(([path, init]) =>
        path === "/api/skills/settings" && init?.method === "PATCH" && String(init.body).includes("trustProject"));
      expect(patch?.[1]?.body).toBe(JSON.stringify({ trustProject: { projectId: "alpha", trusted: true } }));
    });

    // Open detail sheet -> loads SKILL.md content & supporting files.
    fireEvent.click(screen.getByRole("button", { name: "查看 code-review 详情" }));
    expect(await screen.findByText("Check edge cases carefully.")).toBeTruthy();
    expect(screen.getByText("references/checklist.md")).toBeTruthy();

    // Uninstall via confirmation dialog.
    fireEvent.click(screen.getByRole("button", { name: "卸载技能" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认卸载" }));
    await waitFor(() => {
      const del = fetch.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(del?.[0]).toBe("/api/skills?directoryId=user-local&name=code-review&projectId=alpha");
    });
    expect(await screen.findByText("已卸载：code-review")).toBeTruthy();
  });

  it("uploads ZIP to the chosen directory via dialog and refreshes after installation", async () => {
    const { fetch } = setup();
    await screen.findByText("code-review");
    fireEvent.click(screen.getByRole("button", { name: "添加技能" }));
    const file = new File(["zip fixture"], "review.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("上传 ZIP", { selector: "input" }), { target: { files: [file] } });
    await chooseSelect(screen.getByRole("combobox", { name: "安装位置" }), "项目 · 共享目录");
    expect(screen.getByText(/当前项目尚未受信任/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "安装技能" }));
    expect(await screen.findByText("已安装：new-skill")).toBeTruthy();
    expect(fetch.mock.calls.find(([, init]) => init?.method === "POST")).toMatchObject(["/api/skills/install?projectId=alpha&directoryId=project-shared", { body: file, headers: { "Content-Type": "application/zip" } }]);
    await waitFor(() => expect(fetch.mock.calls.filter(([path, init]) => path.startsWith("/api/skills") && !init?.method)).toHaveLength(2));
  });

  it("submits a skill link, retains the form on duplicate-name conflict, and supports overwrite retry", async () => {
    const { fetch } = setup();
    await screen.findByText("code-review");
    fetch.mockImplementation(async (path, init) => {
      if (init?.method === "POST") {
        return path.includes("overwrite=true")
          ? Response.json({ installed: ["review"], directory: "C:/user/.alphacode/skills", requiresNewSession: true }, { status: 201 })
          : Response.json({ code: "SKILL_NAME_CONFLICT" }, { status: 409 });
      }
      return Response.json(fixture());
    });
    fireEvent.click(screen.getByRole("button", { name: "添加技能" }));
    fireEvent.click(screen.getByRole("button", { name: "通过链接" }));
    const url = "https://skills.sh/owner/repo/review";
    fireEvent.change(screen.getByRole("textbox", { name: "技能链接" }), { target: { value: url } });
    fireEvent.click(screen.getByRole("button", { name: "安装技能" }));
    expect((await screen.findByRole("alert")).textContent).toContain("同名技能");
    expect((screen.getByRole("textbox", { name: "技能链接" }) as HTMLInputElement).value).toBe(url);
    expect(fetch.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body).toBe(JSON.stringify({ url }));

    // Retry with overwrite=true.
    fireEvent.click(screen.getByRole("button", { name: "覆盖并安装" }));
    expect(await screen.findByText("已安装：review")).toBeTruthy();
    expect(fetch.mock.calls.some(([path, init]) => init?.method === "POST" && path.includes("overwrite=true"))).toBe(true);
  });

  it("rejects oversized uploads before sending and handles service failure with retry", async () => {
    const { fetch } = setup();
    await screen.findByText("code-review");
    fireEvent.click(screen.getByRole("button", { name: "添加技能" }));
    const file = new File(["x"], "too-big.zip");
    Object.defineProperty(file, "size", { value: skillUploadLimit + 1 });
    fireEvent.change(screen.getByLabelText("上传 ZIP", { selector: "input" }), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "安装技能" }));
    expect((await screen.findByRole("alert")).textContent).toContain("压缩包超出限制");
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "关闭安装表单" }));
    fetch.mockResolvedValueOnce(Response.json({ code: "SERVER_ERROR" }, { status: 500 }));
    fireEvent.click(screen.getByRole("button", { name: "刷新技能" }));
    await screen.findByRole("button", { name: "重试" });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "重试" })).toBeNull());
  });

  it("handles a server without registered projects or directories", async () => {
    setup({ projects: [], directories: [], skills: [], diagnostics: [] });
    expect(await screen.findByText("请先连接项目")).toBeTruthy();
    expect((screen.getByRole("button", { name: "添加技能" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("falls back to an enabled destination when switching project configurations", async () => {
    const { fetch } = setup();
    await screen.findByText("code-review");
    const beta = fixture();
    beta.projectId = "beta";
    beta.directories = beta.directories.map(directory => ({ ...directory, enabled: directory.id === "user-local" }));
    fetch.mockImplementation(async (_path, init) => init?.method === "POST"
      ? Response.json({ installed: ["new-skill"], directory: "C:/user/.alphacode/skills", requiresNewSession: true }, { status: 201 })
      : Response.json(beta));
    await chooseSelect(screen.getByRole("combobox", { name: "当前项目" }), "beta");
    fireEvent.click(screen.getByRole("button", { name: "添加技能" }));
    fireEvent.click(screen.getByRole("button", { name: "通过链接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "技能链接" }), { target: { value: "https://example.com/SKILL.md" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "安装位置" }).textContent).toBe("个人 · 本地安装"));
    expect(within(screen.getByRole("form", { name: "添加技能" })).getByText("C:/user/.alphacode/skills")).toBeTruthy();
    expect(screen.queryByText(/当前项目尚未受信任/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "安装技能" }));
    await screen.findByText("已安装：new-skill");
    expect(fetch.mock.calls.find(([, init]) => init?.method === "POST")?.[0]).toBe("/api/skills/install?projectId=beta&directoryId=user-local");
  });

  it("navigates through the sidebar and returns to session preserving the chat draft", async () => {
    const api = mockSessionApi();
    window.history.replaceState(null, "", "/?session=project-notes");
    const projectId = api.view("project-notes").session.projectId;
    api.overrides.set(`/api/skills?projectId=${projectId}`, () => Response.json(fixture()));
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("heading", { name: "项目说明与约定", level: 1 });
    replaceDraft(screen.getByRole("textbox", { name: "消息草稿" }), "保留我的草稿");
    fireEvent.click(screen.getByRole("button", { name: "技能市场" }));
    await screen.findByRole("heading", { name: "技能市场", level: 1 });
    expect(window.location.pathname).toBe("/skills");
    fireEvent.click(screen.getByRole("button", { name: "返回会话" }));
    expect((screen.getByRole("textbox", { name: "消息草稿" })).textContent).toBe("保留我的草稿");
    expect(window.location.pathname).toBe("/");
  });
});
