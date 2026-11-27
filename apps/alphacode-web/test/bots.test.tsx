import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import type { BotDetailStateView } from "@/features/bots/api";
import { replaceDraft } from "./fixtures/draft-editor";
import { mockSessionApi } from "./fixtures/session-api";

let api: ReturnType<typeof mockSessionApi>;

function seedBot(overrides: Partial<BotDetailStateView> = {}): BotDetailStateView {
  const now = "2026-11-27T08:00:00.000Z";
  const detail: BotDetailStateView = {
    instanceId: "test-server",
    sequence: 1,
    bot: {
      id: "bot_frontend01",
      name: "前端架构管家",
      instructions: "负责维护前端组件库和无障碍规范。",
      projectId: "alphacode-web",
      projectName: "alphacode-web",
      workspaceRoot: "/workspace/apps/alphacode-web",
      projectMissing: false,
      appearance: { shape: "orbit", color: "blue" },
      sortOrder: 1,
      memoryMode: "alphacode",
      lastVisitedAt: now,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      activeTaskCount: 0,
      queuedTaskCount: 0,
      pendingApprovalCount: 0,
      readyDiffCount: 0,
      routerBusy: false,
      effectiveRouterModel: {
        modelId: "deepseek-chat",
        baseURL: "http://127.0.0.1:4000/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        noAuth: false,
        source: "bot",
      },
      effectiveWorkerModel: {
        modelId: "gpt-4.1",
        baseURL: "http://127.0.0.1:4000/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        noAuth: false,
        source: "global_bots",
      },
    },
    router: {
      sessionId: "main",
      modelId: "deepseek-chat",
      phase: "idle",
      busy: false,
      canSend: true,
      canSteer: false,
      pendingTriggerCount: 0,
      messages: [
        { id: "m1", role: "user", text: "帮我检查一下侧边栏组件" },
        { id: "m2", role: "assistant", text: "已启动后台 Worker 在隔离 Worktree 中巡检，你可以继续安排其他任务。" },
      ],
    },
    tasks: [],
    approvals: [],
    ...overrides,
  };
  api.botDetails.set(detail.bot.id, detail);
  return detail;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  api = mockSessionApi();
});

describe("Bots multi-instance Super-agent UI", () => {
  it("creates a new Bot bound to a single project from the sidebar and opens its permanent chat", async () => {
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("button", { name: "文件夹 alphacode-web" });

    const createButtons = screen.getAllByRole("button", { name: "新建 Bot" });
    const firstCreate = createButtons[0];
    if (!firstCreate) throw new Error("Missing create bot button");
    fireEvent.click(firstCreate);

    await screen.findByRole("heading", { name: "新建 Bot" });
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), { target: { value: "发布守卫" } });
    fireEvent.change(screen.getByRole("textbox", { name: "角色指令" }), { target: { value: "负责版本发布前检查。" } });

    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "创建 Bot" });
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(window.location.pathname).toMatch(/^\/bots\/bot_/));
    expect(await screen.findByRole("heading", { name: "发布守卫", level: 1 })).toBeTruthy();

    // Send a message in permanent chat.
    const composer = screen.getByRole("textbox", { name: "Bot 消息草稿" });
    replaceDraft(composer, "开始检查本次改动");
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    await screen.findByText("开始检查本次改动");
  });

  it("shows aggregated approvals inline, inspects Worker diffs in the drawer, and merges cleanly", async () => {
    const detail = seedBot();
    detail.bot = {
      ...detail.bot,
      status: "approval",
      activeTaskCount: 1,
      pendingApprovalCount: 1,
      readyDiffCount: 1,
    };
    detail.approvals = [
      {
        approvalId: "apr_1",
        botId: detail.bot.id,
        botName: detail.bot.name,
        taskId: "tsk_run1",
        taskShortId: "a1b2c3",
        taskTitle: "运行前端测试",
        projectId: detail.bot.projectId,
        workspaceRoot: "/tmp/wt/a1b2c3",
        request: {
          name: "run_command",
          preview: { type: "command", shell: "pwsh", cwd: "/tmp/wt/a1b2c3", command: "bun run test" },
        },
        createdAt: "2026-11-27T08:01:00.000Z",
      },
    ];
    detail.tasks = [
      {
        id: "tsk_diff1",
        botId: detail.bot.id,
        shortId: "d4e5f6",
        title: "优化侧边栏焦点环",
        goal: "修复键盘导航下的焦点样式",
        projectId: detail.bot.projectId,
        workspaceRoot: "/workspace/apps/alphacode-web",
        accessMode: "write",
        isolationMode: "git_worktree",
        worktreePath: "/tmp/wt/d4e5f6",
        worktreeBranch: "alphacode/bot/d4e5f6",
        mainRepoDirtyAtStart: false,
        worktreeState: "ready_for_review",
        workerSessionId: "w_1",
        workerModelId: "gpt-4.1",
        status: "completed",
        resultSummary: "已更新按钮焦点环样式并通过检查。",
        createdAt: "2026-11-27T08:00:00.000Z",
        updatedAt: "2026-11-27T08:02:00.000Z",
        finishedAt: "2026-11-27T08:02:00.000Z",
      },
    ];
    api.botDiffs.set("tsk_diff1", {
      taskId: "tsk_diff1",
      shortId: "d4e5f6",
      isolationMode: "git_worktree",
      worktreeBranch: "alphacode/bot/d4e5f6",
      worktreeState: "ready_for_review",
      hasChanges: true,
      files: [{ path: "src/button.tsx", status: "modified", additions: 4, deletions: 1 }],
      stat: "src/button.tsx | 5 ++++-",
      patch: "@@ -1,2 +1,5 @@\n+focus-visible:ring-2",
      truncated: false,
    });
    api.botTaskSessions.set("tsk_diff1", {
      taskId: "tsk_diff1",
      shortId: "d4e5f6",
      status: "completed",
      live: false,
      messages: [{ id: "wm1", role: "assistant", text: "已完成焦点环样式修复。" }],
    });

    window.history.replaceState(null, "", `/bots/${detail.bot.id}`);
    render(<AppProviders><App /></AppProviders>);

    // Inline aggregated approval appears and can be approved directly.
    await screen.findByText("bun run test");
    fireEvent.click(screen.getByRole("button", { name: "允许一次" }));
    await waitFor(() => expect(screen.queryByText("bun run test")).toBeNull());

    // Open Worker Inspector drawer from the active task pill.
    fireEvent.click(screen.getByRole("button", { name: /#d4e5f6/ }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("alphacode/bot/d4e5f6")).toBeTruthy();
    expect(await within(drawer).findByText("src/button.tsx")).toBeTruthy();
    expect(await within(drawer).findByText("已完成焦点环样式修复。")).toBeTruthy();

    // Merge worktree changes safely.
    fireEvent.click(within(drawer).getByRole("button", { name: "合并回主仓库" }));
    expect(await within(drawer).findByText("变更已成功应用到主仓库。")).toBeTruthy();
  });

  it("guards deletion when unmerged worktrees exist and allows force cleanup", async () => {
    const detail = seedBot();
    detail.tasks = [
      {
        id: "tsk_unmerged",
        botId: detail.bot.id,
        shortId: "u1u2u3",
        title: "未合并改动",
        goal: "修改样式",
        projectId: detail.bot.projectId,
        workspaceRoot: "/workspace/apps/alphacode-web",
        accessMode: "write",
        isolationMode: "git_worktree",
        worktreePath: "/tmp/wt/u1u2u3",
        worktreeBranch: "alphacode/bot/u1u2u3",
        mainRepoDirtyAtStart: false,
        worktreeState: "ready_for_review",
        workerSessionId: "w_u1",
        workerModelId: "gpt-4.1",
        status: "completed",
        createdAt: "2026-11-27T08:00:00.000Z",
        updatedAt: "2026-11-27T08:02:00.000Z",
      },
    ];

    window.history.replaceState(null, "", `/bots/${detail.bot.id}/settings`);
    render(<AppProviders><App /></AppProviders>);

    await screen.findByRole("heading", { name: "Bot 设置" });
    fireEvent.click(screen.getByRole("button", { name: "删除 Bot" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除 Bot" }));

    // 409 UNMERGED_WORKTREES switches dialog into force-delete confirmation.
    expect(await within(dialog).findByText(/未合并的 Git Worktree/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "强制清理 Worktree 并删除" }));

    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(api.botDetails.has(detail.bot.id)).toBe(false);
  });

  it("displays project_missing protection banner and disables sending when bound project is gone", async () => {
    const detail = seedBot();
    detail.bot = {
      ...detail.bot,
      projectMissing: true,
      status: "attention_error",
      statusDetail: "project_missing",
    };

    window.history.replaceState(null, "", `/bots/${detail.bot.id}`);
    render(<AppProviders><App /></AppProviders>);

    expect(await screen.findByText("绑定的工作项目不可用")).toBeTruthy();
    const composer = screen.getByRole("textbox", { name: "Bot 消息草稿" });
    replaceDraft(composer, "尝试发送消息");
    expect((screen.getByRole("button", { name: "发送消息" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("toggles global Auto Memory in Settings and per-Bot memoryMode in Bot settings", async () => {
    window.history.replaceState(null, "", "/settings");
    const first = render(<AppProviders><App /></AppProviders>);

    const memorySwitch = await screen.findByRole("switch", { name: "长期记忆" });
    await waitFor(() => expect(memorySwitch.getAttribute("aria-checked")).toBe("false"));
    fireEvent.click(memorySwitch);
    await waitFor(() => expect(memorySwitch.getAttribute("aria-checked")).toBe("true"));
    first.unmount();

    const detail = seedBot();
    window.history.replaceState(null, "", `/bots/${detail.bot.id}/settings`);
    render(<AppProviders><App /></AppProviders>);
    await screen.findByRole("heading", { name: "Bot 设置" });
    const botMemorySwitch = screen.getByRole("switch", { name: "专属长期记忆" });
    expect(botMemorySwitch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(botMemorySwitch);
    expect(botMemorySwitch.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await waitFor(() => expect(api.botDetails.get(detail.bot.id)?.bot.memoryMode).toBe("off"));
  });

  it("uploads and sends attached files in Bot chat", async () => {
    const detail = seedBot();
    window.history.replaceState(null, "", `/bots/${detail.bot.id}`);
    const app = render(<AppProviders><App /></AppProviders>);

    await screen.findByRole("button", { name: "添加附件" });
    const fileInput = app.container.querySelector('input[type="file"]') as HTMLInputElement;
    const spec = new File(["# Bot Spec"], "bot-spec.md", { type: "text/markdown" });
    fireEvent.change(fileInput, { target: { files: [spec] } });
    expect(await screen.findByText("bot-spec.md")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByRole("link", { name: "打开附件 bot-spec.md" })).toBeTruthy();
    expect(api.fetch.mock.calls.some(([url, init]) => url === `/api/bots/${detail.bot.id}/uploads` && init.method === "POST")).toBe(true);
  });
});
