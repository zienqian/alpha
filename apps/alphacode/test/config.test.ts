import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { readConfig } from "../src/config";
import { errorCode } from "@alpha/alphacode-app-server/errors";



test("workspace selection and existing ADK environment configuration", () => {
  const config = readConfig({ ADK_MODEL: "local-model", ADK_AUTH: "none", ALPHACODE_WORKSPACE: "ignored" }, ["../.."], process.cwd());
  expect(config.workspaceRoot).toBe(resolve(process.cwd(), "../.."));
  expect(config.noAuth).toBe(true);
  expect(readConfig({ ADK_MODEL: "model" }, []).apiKeyEnv).toBe("OPENAI_API_KEY");
  expect(readConfig({ ADK_MODEL: "model", ALPHACODE_SESSION: " saved-session " }, []).sessionId).toBe("saved-session");
  expect(readConfig({ ADK_MODEL: "model", ALPHACODE_SESSION: " " }, []).sessionId).toBeUndefined();
  expect(() => readConfig({}, [])).toThrow("ADK_MODEL");
  expect(() => readConfig({ ADK_MODEL: "model", ADK_AUTH: "typo" }, [])).toThrow("ADK_AUTH");
  expect(errorCode(new Error("secret"))).toBe("UNEXPECTED_ERROR");
});

test("context window overrides follow their configured model", () => {
  const defaults = { modelId: "codex/gpt-6.1-sol", contextWindow: 800000 };
  expect(readConfig({}, [], process.cwd(), defaults).contextWindow).toBe(800000);
  expect(readConfig({ ADK_MODEL: "codex/gpt-6.1-sol" }, [], process.cwd(), defaults).contextWindow).toBe(800000);
  expect(readConfig({ ADK_MODEL: "another-model" }, [], process.cwd(), defaults).contextWindow).toBeUndefined();
});
