import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { sessionNamespace } from "../src/runtime/create-runtime";

test("session namespace preserves existing Windows identity and POSIX case", () => {
  const cwd = "C:\\Users\\Example\\Project";
  const previous = `local:${createHash("sha256").update(cwd.toLowerCase()).digest("hex")}`;
  expect(sessionNamespace(cwd, "win32")).toBe(previous);
  expect(sessionNamespace(cwd.toLowerCase(), "win32")).toBe(previous);
  expect(sessionNamespace("/project/A", "linux")).not.toBe(sessionNamespace("/project/a", "linux"));
});
