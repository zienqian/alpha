import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { ESLint } from "eslint";

test("server and runtime remain independent of all UI clients", async () => {
  const eslint = new ESLint({ cwd: resolve(import.meta.dir, "../../..") });
  for (const file of ["server/server.ts", "chat/controller.ts", "runtime/create-runtime.ts"]) {
    const filePath = resolve(import.meta.dir, "../src", file);
    for (const specifier of ["react", "react/jsx-runtime", "react-dom/client", "@opentui/core", "i18next", "../../../apps/alphacode/src/config"]) {
      const [result] = await eslint.lintText(`export * from "${specifier}";`, { filePath });
      expect(result?.fatalErrorCount).toBe(0);
      expect(result?.messages.some(message => message.ruleId === "no-restricted-syntax")).toBe(true);
    }
  }
  for (const layer of [
    { file: "chat/controller.ts", forbidden: ["@alpha/provider", "../runtime/create-runtime", "../application", "../ui/app"] },
    { file: "runtime/create-runtime.ts", forbidden: ["../chat/controller", "../application", "../ui/app"] },
  ]) {
    const filePath = resolve(import.meta.dir, "../src", layer.file);
    for (const specifier of layer.forbidden) {
      const [result] = await eslint.lintText(`export * from "${specifier}";`, { filePath });
      expect(result?.messages.some(message => message.ruleId === "no-restricted-imports")).toBe(true);
    }
    const [allowed] = await eslint.lintText('export type { Chat } from "../chat/contracts";', { filePath });
    expect(allowed?.errorCount).toBe(0);
  }
});

test("reusable packages and unrelated apps cannot depend on AlphaCode business", async () => {
  const root = resolve(import.meta.dir, "../../..");
  const eslint = new ESLint({ cwd: root });
  for (const file of ["packages/adk/src/core/index.ts", "packages/provider/src/index.ts", "packages/adk-session/src/index.ts", "packages/coding-agent/src/index.ts", "packages/adk-trace/src/index.ts", "apps/example-agent/src/index.ts"]) {
    const [result] = await eslint.lintText('import { ensureServer } from "@alpha/alphacode-app-server/client"; void ensureServer;', { filePath: resolve(root, file) });
    expect(result?.fatalErrorCount).toBe(0);
    expect(result?.messages.some(message => message.ruleId === "@nx/enforce-module-boundaries")).toBe(true);
  }
});
