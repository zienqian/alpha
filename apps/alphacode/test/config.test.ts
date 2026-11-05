import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { readConfig } from "../src/config";
import { errorCode } from "../src/errors";
import { createHash } from "node:crypto";
import { sessionNamespace } from "../src/runtime/create-runtime";

test("session namespace preserves existing Windows identity and POSIX case", () => {
  const cwd = "C:\\Users\\Example\\Project";
  const previous = `local:${createHash("sha256").update(cwd.toLowerCase()).digest("hex")}`;
  expect(sessionNamespace(cwd, "win32")).toBe(previous);
  expect(sessionNamespace(cwd.toLowerCase(), "win32")).toBe(previous);
  expect(sessionNamespace("/project/A", "linux")).not.toBe(sessionNamespace("/project/a", "linux"));
});

test("workspace selection and existing ADK environment configuration", () => {
  const config = readConfig({ ADK_MODEL: "local-model", ADK_AUTH: "none", ALPHACODE_WORKSPACE: "ignored" }, ["../.."], process.cwd());
  expect(config.workspaceRoot).toBe(resolve(process.cwd(), "../.."));
  expect(config.noAuth).toBe(true);
  expect(readConfig({ ADK_MODEL: "model" }, []).apiKeyEnv).toBe("OPENAI_API_KEY");
  expect(() => readConfig({}, [])).toThrow("ADK_MODEL");
  expect(() => readConfig({ ADK_MODEL: "model", ADK_AUTH: "typo" }, [])).toThrow("ADK_AUTH");
  expect(errorCode(new Error("secret"))).toBe("UNEXPECTED_ERROR");
});
