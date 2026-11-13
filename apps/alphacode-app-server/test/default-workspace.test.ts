import { expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultWorkspacePath, globalConfigDirectory, parseGlobalConfig } from "../src/global-config";

test("default workspace paths follow the configuration directory and expand home paths", () => {
  const directory = join(tmpdir(), "alphacode-config");
  expect(defaultWorkspacePath(directory, {})).toBe(join(directory, "workspace"));
  expect(defaultWorkspacePath(directory, parseGlobalConfig("defaultWorkspace: drafts/work", "config.yaml")))
    .toBe(join(directory, "drafts/work"));
  expect(defaultWorkspacePath(directory, { defaultWorkspace: join(tmpdir(), "custom-workspace") }))
    .toBe(join(tmpdir(), "custom-workspace"));
  expect(defaultWorkspacePath(directory, { defaultWorkspace: "~/AlphaCode Workspace" }))
    .toBe(join(homedir(), "AlphaCode Workspace"));
  expect(globalConfigDirectory({ ALPHACODE_HOME: "~/.alphacode-custom" }, directory))
    .toBe(join(homedir(), ".alphacode-custom"));
  expect(globalConfigDirectory({ ALPHACODE_HOME: "custom" }, directory)).toBe(join(directory, "custom"));
});

test("default workspace configuration rejects invalid values", () => {
  for (const value of ["[]", "123", "null", "true", "''", "'  '", '"bad\\0path"', JSON.stringify("x".repeat(4097))]) {
    expect(() => parseGlobalConfig(`defaultWorkspace: ${value}`, "config.yaml")).toThrow("defaultWorkspace");
  }
});
