import { expect, test } from "bun:test";
import type { CodingAction } from "@alpha/coding-agent";
import { permissionDecision } from "../src/runtime/permission-policy";
import { fixture, textResponse, toolResponse, waitFor } from "./helpers";

function commandAction(command: string): CodingAction {
  return {
    kind: "command", cwd: "/project", digest: "test",
    call: { name: "run_command", arguments: { command }, effect: "unknown", callId: "call", assistantId: "assistant" },
    preview: { type: "command", command, cwd: "/project", shell: "sh" },
  };
}

test("auto approval only accepts complete routine commands; shell syntax and unknown commands still ask", () => {
  for (const command of ["pwd", "Get-Location", "git --version", "git status --short", "git diff --no-ext-diff --no-textconv --stat"]) {
    expect(permissionDecision("auto", commandAction(command))).toBe("allow");
    expect(permissionDecision("ask", commandAction(command))).toBe("ask");
  }
  for (const command of [
    "git status; echo changed", "git status && echo changed", "git status | sh", "git status > output.txt",
    "git status\necho changed", "git status\r", "git status $(touch marker)", "git status `whoami`",
    "git -c alias.status=push status", "git status --short --untracked-files=all", "git diff",
    "npm test", "bun run build", "rm -rf target", "Remove-Item target", "curl example.com", "./git status",
  ]) {
    expect(permissionDecision("auto", commandAction(command))).toBe("ask");
  }
  expect(permissionDecision("full", commandAction("echo explicit-full-access"))).toBe("allow");
});

test("permission choices affect real tool authorization and cannot change an active run or pending decision", async () => {
  let command = "git --version";
  const app = await fixture((_body, index) => index % 2 === 1
    ? toolResponse("run_command", { command }) : textResponse("done"));
  try {
    expect(app.chat.state.permissionMode).toBe("ask");
    expect(await app.chat.setPermissionMode("auto")).toBe(true);
    await app.chat.send("check version");
    expect(app.chat.state.approval).toBeUndefined();
    expect(JSON.stringify(app.requests[1])).toContain("git version");

    command = "echo alphacode-permission-test";
    const pending = app.chat.send("unknown commands still ask");
    await waitFor(() => Boolean(app.chat.state.approval));
    expect(await app.chat.setPermissionMode("full")).toBe(false);
    expect(app.chat.state.permissionMode).toBe("auto");
    app.chat.answerApproval(false);
    await pending;
    expect(app.chat.state.messages.find(message => message.role === "tool" && message.note === "denied")).toBeDefined();

    expect(await app.chat.setPermissionMode("full")).toBe(true);
    await app.chat.send("full access");
    expect(JSON.stringify(app.requests[5])).toContain("alphacode-permission-test");
    expect(app.chat.state.approval).toBeUndefined();

    expect(await app.chat.setPermissionMode("ask")).toBe(true);
    command = "git --version";
    const asking = app.chat.send("ask again");
    await waitFor(() => Boolean(app.chat.state.approval));
    app.chat.cancel();
    await asking;
    expect(app.chat.state.permissionMode).toBe("ask");
    expect(app.chat.state.approval).toBeUndefined();
    await app.chat.close();
    expect(await app.chat.setPermissionMode("full")).toBe(false);
  } finally { await app.dispose(); }
});
