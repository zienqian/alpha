import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLanguageArgs, resolveCliLocale } from "../src/i18n/preferences";
import { bootstrapTranslator, startupLocale } from "../src/i18n/bootstrap";
import { createI18n, namespaces } from "../src/i18n/instance";
import { presentNote, presentToolOutput } from "../src/i18n/presentation";
import { Welcome } from "../src/ui/components/welcome";
import { testRender } from "./render";

test("CLI language priority and system locale normalization are explicit", () => {
  expect(parseLanguageArgs(["C:/项目", "--lang=zh-CN"])).toEqual({ positional: ["C:/项目"], language: "zh-CN" });
  expect(resolveCliLocale({ ALPHACODE_LANG: "zh-CN", LANG: "zh_CN.UTF-8" }, ["--lang", "en"], "zh-CN").language).toBe("en");
  expect(resolveCliLocale({ ALPHACODE_LANG: "system", LC_ALL: "C", LANG: "zh_CN.UTF-8" }, [], "zh-CN").language).toBe("en");
  expect(resolveCliLocale({ LANG: "en_US.UTF-8" }, [], "zh-CN").language).toBe("zh-CN");
  expect(resolveCliLocale({ LANG: "zh_CN.UTF-8" }, []).language).toBe("zh-CN");
  expect(() => parseLanguageArgs(["--lang"])).toThrow();
  expect(() => parseLanguageArgs(["--lang", "en", "--lang=zh-CN"])).toThrow();
  expect(() => resolveCliLocale({ ALPHACODE_LANG: "fr" }, [])).toThrow();
});

test("help works with broken model config, is read-only, and is available in both languages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-i18n-"));
  const file = join(directory, "config.yaml"), broken = "model: [broken\n";
  try {
    await writeFile(file, broken);
    const locale = await startupLocale({ ALPHACODE_HOME: directory, ALPHACODE_LANG: "zh-CN" }, []);
    expect(bootstrapTranslator(locale)("help", { version: "test" })).toContain("用法：alphacode");
    const child = Bun.spawn([process.execPath, "--no-env-file", "./bin/alphacode.ts", "--help", "--lang=en"], {
      cwd: join(import.meta.dir, ".."), env: { ...process.env, ALPHACODE_HOME: directory }, stdout: "pipe", stderr: "pipe",
    });
    expect(await new Response(child.stdout).text()).toContain("Usage: alphacode");
    expect(await child.exited).toBe(0);
    expect(await readFile(file, "utf8")).toBe(broken);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("clients translate structured projections independently and retain legacy raw output", () => {
  const en = createI18n("en").getFixedT(null, namespaces), zh = createI18n("zh-CN").getFixedT(null, namespaces);
  const message = { note: "Incomplete preview", noteCode: "INCOMPLETE_PREVIEW" };
  expect(presentNote(en, message)).toBe("Incomplete preview");
  expect(presentNote(zh, message)).not.toBe("Incomplete preview");
  expect(message.note).toBe("Incomplete preview");
  const tool = { name: "read_file", description: "", output: "external raw English", outputLines: ["a", "b", "c", "d", "尾部"], omittedLines: 2 };
  expect(presentToolOutput(en, tool)).toContain("2 lines omitted");
  expect(presentToolOutput(zh, tool)).toContain("2");
  expect(presentToolOutput(zh, { ...tool, outputLines: undefined })).toBe("external raw English");
});

test("OpenTUI renders Chinese at a narrow width while another renderer stays English", async () => {
  const zh = await testRender(<Welcome empty />, { width: 38, height: 14 }, { language: "zh-CN", formatLocale: "zh-CN" });
  const en = await testRender(<Welcome empty />, { width: 70, height: 14 });
  try {
    await zh.renderOnce(); await en.renderOnce();
    expect(zh.captureCharFrame()).toContain("AlphaCode");
    expect(zh.captureCharFrame()).toMatch(/[\u4e00-\u9fff]/);
    expect(en.captureCharFrame()).not.toMatch(/[\u4e00-\u9fff]/);
  } finally { await zh.dispose(); await en.dispose(); }
});
