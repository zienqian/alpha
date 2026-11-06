import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("linked source entry resolves UI preloads outside the repository", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "alphacode-launcher-"));
  try {
    const config = fileURLToPath(new URL("../../../bunfig.toml", import.meta.url));
    const entry = fileURLToPath(new URL("../bin/alphacode.ts", import.meta.url));
    const child = Bun.spawn([process.execPath, "--no-env-file", `--config=${config}`, entry], {
      cwd, env: { ...process.env, ADK_MODEL: "", ALPHACODE_HOME: join(cwd, "config") }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    // Loading succeeds, then configuration validation exits before creating a session or calling a model.
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Set ADK_MODEL");
    expect(stderr).not.toContain("preload not found");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
