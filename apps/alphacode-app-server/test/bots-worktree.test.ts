import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotTaskRecord } from "../src/bots/contracts";
import {
  allocateWorkspace,
  applyWorktreeChanges,
  cleanupWorktree,
  collectWorktreeDiff,
  inspectRepo,
  pruneOrphanWorktrees,
  runGit,
} from "../src/bots/worktree-manager";

const gitEnv = {
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function createGitRepo(dir: string) {
  await mkdir(dir, { recursive: true });
  expect((await runGit(dir, ["init"])).exitCode).toBe(0);
  await writeFile(join(dir, "README.md"), "# Initial\nline 2\n");
  expect((await runGit(dir, ["add", "."])).exitCode).toBe(0);
  expect((await runGit(dir, ["commit", "-m", "initial"], { env: gitEnv })).exitCode).toBe(0);
}

function makeTask(partial: Partial<BotTaskRecord> & { workspaceRoot: string }): BotTaskRecord {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? "tsk_test",
    botId: partial.botId ?? "bot_test",
    shortId: partial.shortId ?? "abcd1234",
    title: partial.title ?? "Test task",
    goal: partial.goal ?? "Update files",
    projectId: partial.projectId ?? "local:proj12345678",
    workspaceRoot: partial.workspaceRoot,
    accessMode: partial.accessMode ?? "write",
    isolationMode: partial.isolationMode ?? "git_worktree",
    worktreePath: partial.worktreePath,
    worktreeBranch: partial.worktreeBranch,
    baseCommit: partial.baseCommit,
    mainRepoDirtyAtStart: partial.mainRepoDirtyAtStart ?? false,
    worktreeState: partial.worktreeState ?? "active",
    workerSessionId: partial.workerSessionId ?? "sess-1",
    workerModelId: partial.workerModelId ?? "offline-model",
    status: partial.status ?? "completed",
    createdAt: now,
    updatedAt: now,
  };
}

test("bot worktree allocation supports readonly, non-git serial fallback, concurrent git worktrees, diff, and safe merge", async () => {
  const root = await mkdtemp(join(tmpdir(), "alphacode-bot-wt-test-"));
  const repoDir = join(root, "repo");
  const plainDir = join(root, "plain");
  const worktrees = join(root, "worktrees");
  try {
    await mkdir(plainDir, { recursive: true });
    await createGitRepo(repoDir);

    const plainAlloc = await allocateWorkspace({
      projectId: "proj1111",
      workspaceRoot: plainDir,
      taskShortId: "plain001",
      accessMode: "write",
      worktreeBaseDir: worktrees,
    });
    expect(plainAlloc.isolationMode).toBe("serial_lock");
    expect(plainAlloc.worktreePath).toBeUndefined();

    const roAlloc = await allocateWorkspace({
      projectId: "proj2222",
      workspaceRoot: repoDir,
      taskShortId: "read0001",
      accessMode: "readonly",
      worktreeBaseDir: worktrees,
    });
    expect(roAlloc.isolationMode).toBe("shared_readonly");
    expect(roAlloc.executionCwd).toBe(await realpath(repoDir));

    const wt1 = await allocateWorkspace({
      projectId: "proj2222",
      workspaceRoot: repoDir,
      taskShortId: "task0001",
      accessMode: "write",
      worktreeBaseDir: worktrees,
    });
    const wt2 = await allocateWorkspace({
      projectId: "proj2222",
      workspaceRoot: repoDir,
      taskShortId: "task0002",
      accessMode: "write",
      worktreeBaseDir: worktrees,
    });
    expect(wt1.isolationMode).toBe("git_worktree");
    expect(wt2.isolationMode).toBe("git_worktree");
    expect(wt1.worktreePath).not.toBe(wt2.worktreePath);
    expect(wt1.worktreeBranch).toBe("alphacode/bot/task0001");
    expect(wt2.worktreeBranch).toBe("alphacode/bot/task0002");

    const wt1Path = wt1.worktreePath ?? "";
    const wt2Path = wt2.worktreePath ?? "";
    await writeFile(join(wt1Path, "README.md"), "# Updated by wt1\nline 2\n");
    await writeFile(join(wt1Path, "feature-a.txt"), "hello from wt1\n");
    await writeFile(join(wt2Path, "feature-b.txt"), "hello from wt2\n");

    expect(await readFile(join(repoDir, "README.md"), "utf8")).toBe("# Initial\nline 2\n");
    expect((await inspectRepo(repoDir)).dirty).toBe(false);

    const task1 = makeTask({
      id: "tsk_1",
      shortId: "task0001",
      title: "Add feature A",
      workspaceRoot: repoDir,
      worktreePath: wt1.worktreePath,
      worktreeBranch: wt1.worktreeBranch,
      baseCommit: wt1.baseCommit,
    });
    const task2 = makeTask({
      id: "tsk_2",
      shortId: "task0002",
      title: "Add feature B",
      workspaceRoot: repoDir,
      worktreePath: wt2.worktreePath,
      worktreeBranch: wt2.worktreeBranch,
      baseCommit: wt2.baseCommit,
    });

    const diff1 = await collectWorktreeDiff(task1);
    expect(diff1.hasChanges).toBe(true);
    expect(diff1.files.map(f => f.path)).toEqual(["README.md", "feature-a.txt"]);
    expect(diff1.patch).toContain("Updated by wt1");
    expect(diff1.patch).toContain("hello from wt1");

    await writeFile(join(repoDir, "dirty.tmp"), "uncommitted");
    const dirtyReject = await applyWorktreeChanges(task1, { strategy: "merge", cleanup: true });
    expect(dirtyReject.applied).toBe(false);
    expect(dirtyReject.reason).toBe("MAIN_REPO_DIRTY");
    await rm(join(repoDir, "dirty.tmp"));

    const merged1 = await applyWorktreeChanges(task1, { strategy: "merge", cleanup: true });
    expect(merged1.applied).toBe(true);
    expect(merged1.cleaned).toBe(true);
    expect(merged1.worktreeState).toBe("cleaned");
    expect((await readFile(join(repoDir, "README.md"), "utf8")).replace(/\r\n/g, "\n")).toBe("# Updated by wt1\nline 2\n");
    expect((await readFile(join(repoDir, "feature-a.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe("hello from wt1\n");
    expect(await stat(wt1Path).catch(() => undefined)).toBeUndefined();

    const patched2 = await applyWorktreeChanges(task2, { strategy: "apply_patch", cleanup: true });
    expect(patched2.applied).toBe(true);
    expect(patched2.cleaned).toBe(true);
    expect((await readFile(join(repoDir, "feature-b.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe("hello from wt2\n");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("bot worktree merge rejects conflicts without mutating main repo and orphan GC protects active worktrees", async () => {
  const root = await mkdtemp(join(tmpdir(), "alphacode-bot-wt-conflict-"));
  const repoDir = join(root, "repo");
  const worktrees = join(root, "worktrees");
  try {
    await createGitRepo(repoDir);
    await writeFile(join(repoDir, "scratch.txt"), "local draft");
    const wtConflict = await allocateWorkspace({
      projectId: "proj3333",
      workspaceRoot: repoDir,
      taskShortId: "conf0001",
      accessMode: "write",
      worktreeBaseDir: worktrees,
    });
    expect(wtConflict.mainRepoDirtyAtStart).toBe(true);
    await rm(join(repoDir, "scratch.txt"));

    await writeFile(join(repoDir, "README.md"), "# Main change\nline 2\n");
    expect((await runGit(repoDir, ["add", "README.md"])).exitCode).toBe(0);
    expect((await runGit(repoDir, ["commit", "-m", "main edit"], { env: gitEnv })).exitCode).toBe(0);

    const conflictPath = wtConflict.worktreePath ?? "";
    await writeFile(join(conflictPath, "README.md"), "# Worktree conflicting change\nline 2\n");
    const conflictTask = makeTask({
      id: "tsk_conf",
      shortId: "conf0001",
      workspaceRoot: repoDir,
      worktreePath: conflictPath,
      worktreeBranch: wtConflict.worktreeBranch,
      baseCommit: wtConflict.baseCommit,
    });

    const res = await applyWorktreeChanges(conflictTask, { strategy: "merge", cleanup: true });
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("MERGE_CONFLICT");
    expect(await readFile(join(repoDir, "README.md"), "utf8")).toBe("# Main change\nline 2\n");
    expect((await inspectRepo(repoDir)).dirty).toBe(false);

    const wtOrphan = await allocateWorkspace({
      projectId: "proj3333",
      workspaceRoot: repoDir,
      taskShortId: "orph0001",
      accessMode: "write",
      worktreeBaseDir: worktrees,
    });
    const orphanPath = wtOrphan.worktreePath ?? "";
    const pruned = await pruneOrphanWorktrees([repoDir], new Set([conflictPath]), worktrees);
    expect(pruned).toBe(1);
    expect((await stat(conflictPath)).isDirectory()).toBe(true);
    expect(await stat(orphanPath).catch(() => undefined)).toBeUndefined();

    await cleanupWorktree(repoDir, conflictPath, wtConflict.worktreeBranch, true);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
