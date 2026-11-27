import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import type {
  BotDiffFile,
  BotTaskAccessMode,
  BotTaskApplyResult,
  BotTaskDiffView,
  BotTaskIsolationMode,
  BotTaskRecord,
} from "./contracts";

const shortIdPattern = /^[a-z0-9_-]{4,24}$/;
const maxPatchBytes = 2 * 1024 * 1024;
const maxUntrackedFileBytes = 512 * 1024;

export interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RepoInspection {
  isGitRepo: boolean;
  repoRoot?: string;
  hasHead: boolean;
  headCommit?: string;
  dirty: boolean;
}

export interface WorktreeAllocation {
  isolationMode: BotTaskIsolationMode;
  executionCwd: string;
  worktreePath?: string;
  worktreeBranch?: string;
  baseCommit?: string;
  mainRepoDirtyAtStart: boolean;
}

function normalizePathKey(value: string): string {
  const normalized = normalize(resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export async function runGit(cwd: string, args: readonly string[], options: { stdin?: string; env?: Record<string, string> } = {}): Promise<GitCommandResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: options.stdin !== undefined ? "pipe" : "ignore",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
      ...options.env,
    },
  });
  if (options.stdin !== undefined && proc.stdin) {
    proc.stdin.write(options.stdin);
    await proc.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function inspectRepo(workspaceRoot: string): Promise<RepoInspection> {
  const top = await runGit(workspaceRoot, ["rev-parse", "--show-toplevel"]);
  if (top.exitCode !== 0 || !top.stdout.trim()) {
    return { isGitRepo: false, hasHead: false, dirty: false };
  }
  const repoRoot = await realpath(top.stdout.trim()).catch(() => top.stdout.trim());
  const head = await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  const hasHead = head.exitCode === 0 && Boolean(head.stdout.trim());
  const status = await runGit(repoRoot, ["status", "--porcelain"]);
  return {
    isGitRepo: true,
    repoRoot,
    hasHead,
    ...(hasHead ? { headCommit: head.stdout.trim() } : {}),
    dirty: status.exitCode === 0 && Boolean(status.stdout.trim()),
  };
}

export async function allocateWorkspace(input: {
  projectId: string;
  workspaceRoot: string;
  taskShortId: string;
  accessMode: BotTaskAccessMode;
  worktreeBaseDir: string;
}): Promise<WorktreeAllocation> {
  if (!shortIdPattern.test(input.taskShortId)) {
    throw Object.assign(new Error("INVALID_TASK_ID"), { code: "INVALID_TASK_ID" });
  }
  const workspaceRoot = await realpath(input.workspaceRoot);
  const info = await inspectRepo(workspaceRoot);
  if (input.accessMode === "readonly") {
    return {
      isolationMode: "shared_readonly",
      executionCwd: workspaceRoot,
      ...(info.headCommit ? { baseCommit: info.headCommit } : {}),
      mainRepoDirtyAtStart: info.dirty,
    };
  }
  if (!info.isGitRepo || !info.repoRoot || !info.hasHead || !info.headCommit) {
    return {
      isolationMode: "serial_lock",
      executionCwd: workspaceRoot,
      mainRepoDirtyAtStart: info.dirty,
    };
  }
  const projectPrefix = input.projectId.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "project";
  const worktreeDir = join(input.worktreeBaseDir, projectPrefix, input.taskShortId);
  const branch = `alphacode/bot/${input.taskShortId}`;
  await mkdir(dirname(worktreeDir), { recursive: true });
  const created = await runGit(info.repoRoot, ["worktree", "add", "-b", branch, worktreeDir, info.headCommit]);
  if (created.exitCode !== 0) {
    throw Object.assign(new Error(`WORKTREE_CREATE_FAILED: ${created.stderr.trim() || created.stdout.trim()}`), { code: "WORKTREE_CREATE_FAILED" });
  }
  const resolvedWorktree = await realpath(worktreeDir).catch(() => worktreeDir);
  const relSubdir = relative(info.repoRoot, workspaceRoot);
  const executionCwd = relSubdir && !relSubdir.startsWith("..") ? join(resolvedWorktree, relSubdir) : resolvedWorktree;
  return {
    isolationMode: "git_worktree",
    executionCwd,
    worktreePath: resolvedWorktree,
    worktreeBranch: branch,
    baseCommit: info.headCommit,
    mainRepoDirtyAtStart: info.dirty,
  };
}

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const add = Number.parseInt(parts[0] ?? "0", 10);
    const del = Number.parseInt(parts[1] ?? "0", 10);
    const file = parts.slice(2).join("\t");
    result.set(file, {
      additions: Number.isFinite(add) ? add : 0,
      deletions: Number.isFinite(del) ? del : 0,
    });
  }
  return result;
}

function parseNameStatus(output: string): { path: string; status: BotDiffFile["status"] }[] {
  const files: { path: string; status: BotDiffFile["status"] }[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const path = parts[parts.length - 1] ?? "";
    if (!path) continue;
    const status: BotDiffFile["status"] = code.startsWith("A")
      ? "added"
      : code.startsWith("D")
        ? "deleted"
        : code.startsWith("R")
          ? "renamed"
          : "modified";
    files.push({ path, status });
  }
  return files;
}

async function renderUntrackedPatch(worktreePath: string, relPath: string): Promise<{ additions: number; patch: string }> {
  const fullPath = join(worktreePath, relPath);
  try {
    const info = await stat(fullPath);
    if (!info.isFile()) return { additions: 0, patch: "" };
    if (info.size > maxUntrackedFileBytes) {
      return {
        additions: 0,
        patch: `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1 @@\n+[binary or large untracked file omitted: ${info.size} bytes]\n`,
      };
    }
    const raw = await readFile(fullPath);
    if (raw.includes(0)) {
      return {
        additions: 0,
        patch: `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\nBinary files /dev/null and b/${relPath} differ\n`,
      };
    }
    const content = raw.toString("utf8");
    const lines = content.length === 0 ? [] : content.replace(/\r\n/g, "\n").split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    const header = [
      `diff --git a/${relPath} b/${relPath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${relPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
    ];
    const body = lines.map(line => `+${line}`);
    return {
      additions: lines.length,
      patch: `${header.join("\n")}\n${body.join("\n")}\n`,
    };
  } catch {
    return { additions: 0, patch: "" };
  }
}

function truncateUtf8(text: string, limit: number): { value: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= limit) return { value: text, truncated: false };
  return { value: buf.subarray(0, limit).toString("utf8"), truncated: true };
}

export async function collectWorktreeDiff(task: BotTaskRecord): Promise<BotTaskDiffView> {
  if (task.isolationMode !== "git_worktree" || !task.worktreePath) {
    return {
      taskId: task.id,
      shortId: task.shortId,
      isolationMode: task.isolationMode,
      worktreePath: task.worktreePath,
      worktreeBranch: task.worktreeBranch,
      baseCommit: task.baseCommit,
      worktreeState: task.worktreeState,
      hasChanges: false,
      files: [],
      stat: "",
      patch: "",
      truncated: false,
      diffArtifactRef: task.diffArtifactRef,
    };
  }
  const exists = await stat(task.worktreePath).then(s => s.isDirectory()).catch(() => false);
  if (!exists) {
    return {
      taskId: task.id,
      shortId: task.shortId,
      isolationMode: task.isolationMode,
      worktreePath: task.worktreePath,
      worktreeBranch: task.worktreeBranch,
      baseCommit: task.baseCommit,
      worktreeState: task.worktreeState,
      hasChanges: false,
      files: [],
      stat: "",
      patch: "",
      truncated: false,
      diffArtifactRef: task.diffArtifactRef,
    };
  }
  const base = task.baseCommit ?? "HEAD";
  const [nameStatusRes, numstatRes, statRes, diffRes, untrackedRes] = await Promise.all([
    runGit(task.worktreePath, ["diff", "--name-status", base]),
    runGit(task.worktreePath, ["diff", "--numstat", base]),
    runGit(task.worktreePath, ["diff", "--stat", base]),
    runGit(task.worktreePath, ["diff", "--binary", base]),
    runGit(task.worktreePath, ["ls-files", "--others", "--exclude-standard"]),
  ]);

  const numstat = parseNumstat(numstatRes.stdout);
  const files: BotDiffFile[] = parseNameStatus(nameStatusRes.stdout).map(item => ({
    path: item.path,
    status: item.status,
    additions: numstat.get(item.path)?.additions ?? 0,
    deletions: numstat.get(item.path)?.deletions ?? 0,
  }));

  const patches: string[] = [];
  if (diffRes.stdout) patches.push(diffRes.stdout);

  const untracked = untrackedRes.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (const relPath of untracked) {
    const rendered = await renderUntrackedPatch(task.worktreePath, relPath);
    files.push({ path: relPath, status: "untracked", additions: rendered.additions, deletions: 0 });
    if (rendered.patch) patches.push(rendered.patch);
  }

  const statLines = [statRes.stdout.trim()];
  if (untracked.length) statLines.push(`Untracked files: ${untracked.join(", ")}`);
  const fullPatch = patches.join(patches.length > 1 ? "\n" : "");
  const bounded = truncateUtf8(fullPatch, maxPatchBytes);

  return {
    taskId: task.id,
    shortId: task.shortId,
    isolationMode: task.isolationMode,
    worktreePath: task.worktreePath,
    worktreeBranch: task.worktreeBranch,
    baseCommit: task.baseCommit,
    worktreeState: task.worktreeState,
    hasChanges: files.length > 0,
    files,
    stat: statLines.filter(Boolean).join("\n"),
    patch: bounded.value,
    truncated: bounded.truncated,
    diffArtifactRef: task.diffArtifactRef,
  };
}

async function ensureWorktreeChangesCommitted(task: BotTaskRecord): Promise<{ ok: boolean; reason?: string }> {
  if (!task.worktreePath) return { ok: false, reason: "WORKTREE_MISSING" };
  const status = await runGit(task.worktreePath, ["status", "--porcelain"]);
  if (status.exitCode !== 0) return { ok: false, reason: "WORKTREE_STATUS_FAILED" };
  if (!status.stdout.trim()) return { ok: true };
  const add = await runGit(task.worktreePath, ["add", "-A"]);
  if (add.exitCode !== 0) return { ok: false, reason: add.stderr.trim() || "GIT_ADD_FAILED" };
  const commit = await runGit(
    task.worktreePath,
    ["commit", "--no-verify", "-m", `alphacode(bot): ${task.title.replace(/[\r\n]+/g, " ").slice(0, 72)} [${task.shortId}]`],
    {
      env: {
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "AlphaCode Bot",
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "bot@alphacode.local",
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "AlphaCode Bot",
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "bot@alphacode.local",
      },
    },
  );
  if (commit.exitCode !== 0) {
    return { ok: false, reason: commit.stderr.trim() || "GIT_COMMIT_FAILED" };
  }
  return { ok: true };
}

export async function cleanupWorktree(repoRoot: string, worktreePath: string, branch?: string, deleteBranch = true): Promise<boolean> {
  const removed = await runGit(repoRoot, ["worktree", "remove", "--force", worktreePath]);
  if (removed.exitCode !== 0) {
    await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
  }
  await runGit(repoRoot, ["worktree", "prune"]);
  if (deleteBranch && branch) {
    await runGit(repoRoot, ["branch", "-D", branch]);
  }
  return true;
}

export async function applyWorktreeChanges(
  task: BotTaskRecord,
  options: { strategy: "merge" | "apply_patch"; cleanup?: boolean },
): Promise<BotTaskApplyResult> {
  if (task.isolationMode !== "git_worktree" || !task.worktreePath || !task.worktreeBranch) {
    return {
      applied: false,
      strategy: options.strategy,
      worktreeState: task.worktreeState,
      cleaned: false,
      reason: "NOT_A_WORKTREE_TASK",
    };
  }
  const exists = await stat(task.worktreePath).then(s => s.isDirectory()).catch(() => false);
  if (!exists) {
    return {
      applied: false,
      strategy: options.strategy,
      worktreeState: task.worktreeState,
      cleaned: false,
      reason: "WORKTREE_MISSING",
    };
  }
  const repo = await inspectRepo(task.workspaceRoot);
  if (!repo.isGitRepo || !repo.repoRoot || !repo.hasHead) {
    return {
      applied: false,
      strategy: options.strategy,
      worktreeState: task.worktreeState,
      cleaned: false,
      reason: "MAIN_REPO_INVALID",
    };
  }

  const diff = await collectWorktreeDiff(task);
  if (!diff.hasChanges) {
    const cleaned = options.cleanup !== false
      ? await cleanupWorktree(repo.repoRoot, task.worktreePath, task.worktreeBranch, true)
      : false;
    return {
      applied: true,
      strategy: options.strategy,
      worktreeState: cleaned ? "cleaned" : "merged",
      cleaned,
      reason: "NO_CHANGES",
    };
  }

  if (options.strategy === "apply_patch") {
    const committed = await ensureWorktreeChangesCommitted(task);
    if (!committed.ok) {
      return { applied: false, strategy: "apply_patch", worktreeState: task.worktreeState, cleaned: false, reason: committed.reason };
    }
    const base = task.baseCommit ?? "HEAD";
    const patchRes = await runGit(repo.repoRoot, ["diff", "--binary", base, task.worktreeBranch]);
    if (patchRes.exitCode !== 0 || !patchRes.stdout) {
      return { applied: false, strategy: "apply_patch", worktreeState: task.worktreeState, cleaned: false, reason: "PATCH_GENERATION_FAILED" };
    }
    const check = await runGit(repo.repoRoot, ["apply", "--check", "--3way"], { stdin: patchRes.stdout });
    if (check.exitCode !== 0) {
      return {
        applied: false,
        strategy: "apply_patch",
        worktreeState: task.worktreeState,
        cleaned: false,
        reason: "PATCH_CONFLICT",
      };
    }
    const applied = await runGit(repo.repoRoot, ["apply", "--3way"], { stdin: patchRes.stdout });
    if (applied.exitCode !== 0) {
      return {
        applied: false,
        strategy: "apply_patch",
        worktreeState: task.worktreeState,
        cleaned: false,
        reason: applied.stderr.trim() || "PATCH_APPLY_FAILED",
      };
    }
    const cleaned = options.cleanup !== false
      ? await cleanupWorktree(repo.repoRoot, task.worktreePath, task.worktreeBranch, true)
      : false;
    return {
      applied: true,
      strategy: "apply_patch",
      worktreeState: cleaned ? "cleaned" : "merged",
      cleaned,
    };
  }

  // strategy === "merge": never touch a dirty primary repository
  if (repo.dirty) {
    return {
      applied: false,
      strategy: "merge",
      worktreeState: task.worktreeState,
      cleaned: false,
      reason: "MAIN_REPO_DIRTY",
    };
  }

  const committed = await ensureWorktreeChangesCommitted(task);
  if (!committed.ok) {
    return { applied: false, strategy: "merge", worktreeState: task.worktreeState, cleaned: false, reason: committed.reason };
  }

  // Preflight conflict detection via git merge-tree --write-tree without touching working tree.
  const preflight = await runGit(repo.repoRoot, ["merge-tree", "--write-tree", "HEAD", task.worktreeBranch]);
  if (preflight.exitCode !== 0) {
    const conflicts = preflight.stdout
      .split(/\r?\n/)
      .filter(line => line.startsWith("CONFLICT"))
      .map(line => line.trim());
    return {
      applied: false,
      strategy: "merge",
      worktreeState: task.worktreeState,
      cleaned: false,
      conflictFiles: conflicts.length ? conflicts : undefined,
      reason: "MERGE_CONFLICT",
    };
  }

  const merged = await runGit(repo.repoRoot, ["merge", "--no-edit", task.worktreeBranch], {
    env: {
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "AlphaCode Bot",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "bot@alphacode.local",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "AlphaCode Bot",
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "bot@alphacode.local",
    },
  });
  if (merged.exitCode !== 0) {
    await runGit(repo.repoRoot, ["merge", "--abort"]);
    return {
      applied: false,
      strategy: "merge",
      worktreeState: task.worktreeState,
      cleaned: false,
      reason: "MERGE_CONFLICT",
    };
  }

  const cleaned = options.cleanup !== false
    ? await cleanupWorktree(repo.repoRoot, task.worktreePath, task.worktreeBranch, true)
    : false;
  return {
    applied: true,
    strategy: "merge",
    worktreeState: cleaned ? "cleaned" : "merged",
    cleaned,
  };
}

export async function pruneOrphanWorktrees(
  repoRoots: readonly string[],
  protectedPaths: ReadonlySet<string>,
  worktreeBaseDir: string,
): Promise<number> {
  const baseKey = normalizePathKey(worktreeBaseDir);
  const protectedKeys = new Set([...protectedPaths].map(normalizePathKey));
  let pruned = 0;

  for (const root of new Set(repoRoots)) {
    const info = await inspectRepo(root).catch(() => ({ isGitRepo: false, hasHead: false, dirty: false } as RepoInspection));
    if (!info.isGitRepo || !info.repoRoot) continue;
    const listed = await runGit(info.repoRoot, ["worktree", "list", "--porcelain"]);
    if (listed.exitCode !== 0) continue;

    let currentPath: string | undefined;
    let currentBranch: string | undefined;
    const entries: { path: string; branch?: string }[] = [];
    for (const rawLine of [...listed.stdout.split(/\r?\n/), ""]) {
      const line = rawLine.trim();
      if (!line) {
        if (currentPath) entries.push({ path: currentPath, branch: currentBranch });
        currentPath = undefined;
        currentBranch = undefined;
        continue;
      }
      if (line.startsWith("worktree ")) currentPath = line.slice("worktree ".length).trim();
      else if (line.startsWith("branch refs/heads/")) currentBranch = line.slice("branch refs/heads/".length).trim();
    }

    for (const entry of entries) {
      const resolvedPath = await realpath(entry.path).catch(() => entry.path);
      const key = normalizePathKey(resolvedPath);
      if (!key.startsWith(baseKey) || key === baseKey) continue;
      if (protectedKeys.has(key)) continue;
      if (entry.branch && !entry.branch.startsWith("alphacode/bot/")) continue;
      await cleanupWorktree(info.repoRoot, resolvedPath, entry.branch, true);
      pruned++;
    }
    await runGit(info.repoRoot, ["worktree", "prune"]);
  }
  return pruned;
}
