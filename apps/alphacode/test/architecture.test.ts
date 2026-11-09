import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { ESLint } from "eslint";

test("UI, conversation, and runtime implementations respect the injected contracts", async () => {
  const eslint = new ESLint({ cwd: resolve(import.meta.dir, "../../..") });
  const layers = [
    { file: "ui/app.tsx", contract: "../chat/contracts", forbidden: ["@alpha/adk/core", "@alpha/adk-session/sqlite", "../runtime/create-runtime", "../chat/controller", "../application"] },
    { file: "chat/controller.ts", contract: "./contracts", forbidden: ["@opentui/core", "react", "react/jsx-runtime", "react-dom/client", "@alpha/provider", "../runtime/create-runtime", "../application", "../ui/app"] },
    { file: "runtime/create-runtime.ts", contract: "../chat/contracts", forbidden: ["react", "react/jsx-runtime", "react-dom/client", "../chat/controller", "../ui/app", "../application"] },
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
