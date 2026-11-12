import { expect, test } from "bun:test";
import { searchSession } from "../src/server/search";

const session = { id: "session", projectId: "project", title: "普通会话", workspaceRoot: "/workspace/project", updatedAt: "", status: "ready" };

test("search counts all matching messages while bounding previews and including tool contents", () => {
  const messages = Array.from({ length: 5 }, (_, index) => ({ id: String(index), role: "assistant" as const, text: `匹配 ${index}` }));
  const result = searchSession(session, messages, "匹配");
  expect(result?.matchCount).toBe(5);
  expect(result?.snippets).toHaveLength(3);
  const tool = searchSession(session, [{ id: "tool", role: "tool", text: "run_command", tool: {
    id: "tool", assistantId: "assistant", callId: "call", name: "run_command", description: "命令", descriptionSource: "fallback", target: "command", status: "succeeded", output: "unique-tool-output",
  } }], "unique-tool-output");
  expect(tool?.snippets[0]?.role).toBe("tool");
});

test("search treats code punctuation literally and finds a match deep in long content", () => {
  const result = searchSession(session, [{ id: "message", role: "user", text: `${"前文".repeat(200)}a+b [x]${"后文".repeat(200)}` }], "A+B");
  expect(result?.snippets[0]?.text).toContain("a+b");
  expect(result?.snippets[0]?.text).toStartWith("…");
  expect(searchSession(session, [{ id: "message", role: "user", text: "aaab" }], "a+b")).toBeUndefined();
});
