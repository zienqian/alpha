import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { cliBridge, cliBridgeMarker, cliCommandName, findInstalledCli, withBundledCommands } from "../src/cli-command";
import { installCliCommand, registerShellCliPath } from "../src/install-cli";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "alphacode-cli-test-"));
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("alphacode-cli-test-")) throw new Error("Unsafe cleanup");
  try { await run(root); }
  finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function command(directory: string, content: string) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, cliCommandName);
  await writeFile(file, content);
  await chmod(file, 0o755);
  return file;
}

test("CLI discovery skips App bridges and keeps the user's PATH priority", () => fixture(async root => {
  const app = join(root, "app cli");
  const first = join(root, "first user cli");
  const second = join(root, "second user cli");
  await command(app, cliBridge(join(root, "runtime")));
  const selected = await command(first, process.platform === "win32" ? "@echo user\r\n" : "#!/bin/sh\necho user\n");
  await command(second, "another user command");
  expect(await findInstalledCli({ PATH: ["", ".", app, first, second].join(delimiter) })).toBe(selected);
  expect(await findInstalledCli({ PATH: app })).toBeUndefined();
  const env = withBundledCommands(root, { PATH: first, EXAMPLE: "unchanged" });
  expect(env.PATH?.split(delimiter)).toEqual([first, join(root, "bin"), join(root, "cli")]);
  expect(env.EXAMPLE).toBe("unchanged");
}));

test("installing a terminal command leaves an existing CLI and PATH untouched", () => fixture(async root => {
  const existing = await command(join(root, "user bin"), "user-managed command");
  let registrations = 0;
  const result = await installCliCommand({ root: join(root, "runtime"), home: join(root, "home"),
    env: { PATH: dirname(existing) }, registerPath: async () => { registrations++; } });
  expect(result).toEqual({ kind: "existing", command: existing });
  expect(await readFile(existing, "utf8")).toBe("user-managed command");
  expect(registrations).toBe(0);
}));

test("App bridges can be refreshed after moving the App without replacing unrelated commands", () => fixture(async root => {
  const home = join(root, "home");
  const registered: string[] = [];
  const options = { home, env: { PATH: "" }, registerPath: async (directory: string) => { registered.push(directory); } };
  const first = await installCliCommand({ ...options, root: join(root, "original runtime") });
  expect(first.kind).toBe("installed");
  expect(await readFile(first.command, "utf8")).toContain(cliBridgeMarker);
  const moved = join(root, "moved runtime");
  await installCliCommand({ ...options, root: moved });
  expect(await readFile(first.command, "utf8")).toBe(cliBridge(moved));
  expect(registered).toEqual([join(home, ".alphacode/bin"), join(home, ".alphacode/bin")]);
  await writeFile(first.command, "user replacement");
  expect((await installCliCommand({ ...options, root: moved })).kind).toBe("existing");
  expect(await readFile(first.command, "utf8")).toBe("user replacement");
  expect(registered).toHaveLength(2);
}));

test("shell setup preserves user configuration, appends PATH and is idempotent", () => fixture(async root => {
  const bin = join(root, "my user's bin");
  await writeFile(join(root, ".bash_profile"), "# user's login setup\n");
  await writeFile(join(root, ".bashrc"), "# user's interactive setup\n");
  await registerShellCliPath(bin, root, { SHELL: "/bin/bash" });
  const first = await readFile(join(root, ".bash_profile"), "utf8");
  expect(first).toStartWith("# user's login setup\n");
  expect(first).toContain('export PATH="${PATH:+$PATH:}"');
  expect(first).toContain("'\\''");
  await registerShellCliPath(bin, root, { SHELL: "/bin/bash" });
  expect(await readFile(join(root, ".bash_profile"), "utf8")).toBe(first);
  expect(await readFile(join(root, ".bashrc"), "utf8")).toStartWith("# user's interactive setup\n");
  const zdot = join(root, "zsh config");
  await registerShellCliPath(bin, root, { SHELL: "/bin/zsh", ZDOTDIR: zdot });
  expect(await readFile(join(zdot, ".zprofile"), "utf8")).toContain("AlphaCode App terminal command");
  expect(await readFile(join(zdot, ".zshrc"), "utf8")).toContain("AlphaCode App terminal command");
  const config = join(root, "fish config");
  await registerShellCliPath(bin, root, { SHELL: "/usr/bin/fish", XDG_CONFIG_HOME: config });
  expect(await readFile(join(config, "fish/conf.d/alphacode.fish"), "utf8")).toContain("set -gx PATH $PATH");
}));
