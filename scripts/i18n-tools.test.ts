import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("pinned x18n accepts Chinese plurals and catches missing, empty, duplicate and invalid interpolation resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "alpha-x18n-pilot-"));
  const cli = join(dirname(fileURLToPath(import.meta.resolve("@x18n/cli"))), "../bin.mjs");
  try {
    await mkdir(join(root, "locales/en"), { recursive: true });
    await mkdir(join(root, "locales/zh-CN"), { recursive: true });
    await writeFile(join(root, "x18n.config.json"), JSON.stringify({
      checks: { "missing-translation": "error", "empty-translation": "error", "placeholder-mismatch": "error", "unused-key": "warning", "hard-string": "warning" },
      sourceLocale: "en", locales: ["en", "zh-CN"], presets: ["i18next"],
      resources: [{ pattern: "locales/{locale}/{namespace}.json" }],
      namespace: { separator: ":", default: "common" }, usage: { include: ["sample.tsx"] },
    }));
    await writeFile(join(root, "sample.tsx"), 't("common:items", { count: 2 }); const label = t("common:greeting", { name: "test" }); <button aria-label={t("common:greeting", { name: "test" })} />;');
    await writeFile(join(root, "locales/en/common.json"), JSON.stringify({ items_one: "{{count}} item", items_other: "{{count}} items", greeting: "Hello {{name}}", indirect: "Mapping key" }));
    const target = join(root, "locales/zh-CN/common.json");
    async function check(text: string) {
      await writeFile(target, text);
      const child = Bun.spawn([process.execPath, cli, "check", "--root", root, "--json"], { stdout: "pipe", stderr: "pipe" });
      const result = await new Response(child.stdout).json() as { diagnostics: { code: string; severity: string }[] };
      return { code: await child.exited, diagnostics: result.diagnostics };
    }
    const valid = { items_other: "{{count}} 项", greeting: "你好 {{name}}", indirect: "映射键" };
    const good = await check(JSON.stringify(valid));
    expect(good.code).toBe(0);
    expect(good.diagnostics.some(d => d.code === "unused-key" && d.severity === "warning")).toBe(true);
    for (const broken of [
      JSON.stringify({ items_other: valid.items_other, indirect: valid.indirect }),
      JSON.stringify({ ...valid, greeting: "" }),
      JSON.stringify({ ...valid, greeting: "你好 {{wrongName}}" }),
      '{"items_other":"{{count}} 项","greeting":"你好 {{name}}","greeting":"重复","indirect":"映射键"}',
    ]) {
      const result = await check(broken);
      expect(result.code, JSON.stringify(result.diagnostics)).not.toBe(0);
    }
    await writeFile(join(root, "sample.tsx"), 'const status = "Saving your session"; <button aria-label="保存会话">Save conversation</button>;');
    const hardStrings = (await check(JSON.stringify(valid))).diagnostics.filter(d => d.code === "hard-string");
    expect(hardStrings).toHaveLength(3);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
