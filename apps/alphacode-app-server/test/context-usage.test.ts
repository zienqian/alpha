import { expect, test } from "bun:test";
import { modelContext, estimateContext, restoreContext } from "../src/runtime/context-usage";
import { parseGlobalConfig } from "../src/global-config";
import { createApplication } from "../src/application";
import { fixture, textResponse, toolResponse } from "./helpers";

test("resolves the verified API and Codex limits without guessing unknown models", () => {
  expect(modelContext("codex/gpt-6.1-sol").contextWindow).toBe(500_000);
  expect(modelContext("gpt-6.1-sol").contextWindow).toBe(1_050_000);
  expect(modelContext("some-proxy/gpt-6.1-sol").contextWindow).toBeUndefined();
  expect(modelContext("custom", 64_000)).toMatchObject({ contextWindow: 64_000, windowSource: "configuration" });
});

test("validates window overrides and ignores invalid restored aggregates", () => {
  expect(parseGlobalConfig("model: { id: custom, contextWindow: 64000 }", "config.yaml").contextWindow).toBe(64_000);
  for (const invalid of ["0", "-1", "1.5", "'500000'", "null"]) {
    expect(() => parseGlobalConfig(`model: { contextWindow: ${invalid} }`, "config.yaml")).toThrow();
  }
  const model = modelContext("custom");
  expect(restoreContext({ modelId: "custom", tokens: { system: 1, tools: 2, messages: 3, total: 9 } }, model)).toEqual(model);
});

test("counts raw tool definitions and results without retaining payload contents", () => {
  const model = modelContext("custom");
  const usage = estimateContext({ messages: [{ role: "system", content: "private instructions" },
    { role: "user", content: "中文请求" }, { role: "tool", toolCallId: "a", content: "x".repeat(4000) }],
    tools: [{ name: "read", description: "read file", inputSchema: { type: "object" } }] }, model);
  if (!usage.tokens) throw new Error("Expected request counts");
  expect(usage.tokens.system).toBeGreaterThan(0);
  expect(usage.tokens.tools).toBeGreaterThan(0);
  expect(usage.tokens.messages).toBeGreaterThan(1000);
  expect(JSON.stringify(usage)).not.toContain("private instructions");
  expect(restoreContext(usage, model)).toEqual(usage);
});

test("publishes the latest request across tool calls, persists it, and excludes title generation", async () => {
  const app = await fixture((_body, index) => index === 1 ? toolResponse("read_file", { path: "hello.txt" }) : textResponse("done"));
  const totals: number[] = [];
  const unsubscribe = app.chat.subscribe(state => {
    if (state.contextUsage?.tokens) totals.push(state.contextUsage.tokens.total);
  });
  try {
    expect(app.chat.state.contextUsage?.tokens).toBeUndefined();
    await app.chat.send("read hello.txt");
    expect(app.requests).toHaveLength(2);
    expect(app.titleRequests).toHaveLength(1);
    const usage = app.chat.state.contextUsage;
    if (!usage?.tokens) throw new Error("Expected live context usage");
    expect(usage.tokens.tools).toBeGreaterThan(100);
    expect(new Set(totals).size).toBe(2);
    const requests = [...new Set(totals)];
    const [first, last] = requests;
    if (first === undefined || last === undefined) throw new Error("Expected two request snapshots");
    expect(usage.tokens.total).toBe(last);
    expect(last).toBeGreaterThan(first);
    expect(usage.tokens.total).toBeLessThan(first + last);
    await app.chat.close();
    const reopened = await createApplication({ ...app.config, sessionId: app.chat.sessionId }, { provider: { fetch: async () => textResponse("unused") } });
    try { expect(reopened.state.contextUsage).toEqual(usage); }
    finally { await reopened.close(); }
  } finally { unsubscribe(); await app.dispose(); }
});
