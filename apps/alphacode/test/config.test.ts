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
