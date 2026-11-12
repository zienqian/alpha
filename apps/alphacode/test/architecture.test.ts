import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { ESLint } from "eslint";

test("UI, conversation, and runtime implementations respect the injected contracts", async () => {
  const eslint = new ESLint({ cwd: resolve(import.meta.dir, "../../..") });
  const layers = [
    { file: "ui/app.tsx", contract: "@alpha/alphacode-app-server/contracts", forbidden: ["@alpha/adk/core", "@alpha/adk-session/sqlite", "@alpha/alphacode-app-server", "@alpha/alphacode-app-server/client", "../runtime/create-runtime", "../chat/controller", "../application"] },
  ];
  for (const layer of layers) {
    const filePath = resolve(import.meta.dir, "../src", layer.file);
    for (const specifier of layer.forbidden) {
      const [result] = await eslint.lintText(`export * from "${specifier}";`, { filePath });
      expect(result?.fatalErrorCount).toBe(0);
      expect(result?.messages.some(message => message.ruleId === "no-restricted-imports")).toBe(true);
    }
    const [allowed] = await eslint.lintText(`export type { Chat } from "${layer.contract}";`, { filePath });
    expect(allowed?.errorCount).toBe(0);
  }
});

test("the CLI entry point can connect but cannot instantiate server business", async () => {
  const eslint = new ESLint({ cwd: resolve(import.meta.dir, "../../..") });
  const filePath = resolve(import.meta.dir, "../src/index.tsx");
  for (const entry of ["@alpha/alphacode-app-server", "@alpha/alphacode-app-server/testing"]) {
    const [result] = await eslint.lintText(`const server = import("${entry}"); void server;`, { filePath });
    expect(result?.messages.some(message => message.ruleId === "no-restricted-syntax")).toBe(true);
  }
  const [allowed] = await eslint.lintText('export { connectApplication } from "@alpha/alphacode-app-server/client";', { filePath });
  expect(allowed?.errorCount).toBe(0);
});
