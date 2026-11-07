import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { TextareaRenderable } from "@opentui/core";
import type { Chat } from "../src/chat/contracts";
import { App } from "../src/ui/app";

test("skill completion, arguments, list command and slash escape reach the dispatcher", async () => {
  const sent: string[] = [];
  const chat: Chat = {
    state: { messages: [], busy: false, closing: false, canSend: true, status: "Ready", phase: "idle", permissionMode: "ask", settingsSaving: false },
    modelId: "test", workspaceRoot: "/project", sessionId: "test",
    skills: [{ name: "review", description: "Review changes", argumentHint: "[files]", userInvocable: true },
      { name: "review-private", description: "Model only", userInvocable: false }],
    subscribe: () => () => undefined,
    async send(input) { sent.push(input); },
    cancel: () => undefined,
    answerApproval: () => undefined,
    setPermissionMode: async () => false,
    close: async () => undefined,
  };
  const ui = await testRender(() => <App chat={chat} onExit={() => undefined} />, { width: 100, height: 32 });
  const input = ui.renderer.root.findDescendantById("prompt") as TextareaRenderable;
  try {
    await ui.renderOnce();
    await ui.mockInput.typeText("/rev");
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("/review");
    expect(ui.captureCharFrame()).not.toContain("review-private");
    ui.mockInput.pressTab();
    expect(input.plainText).toBe("/review");
    await ui.mockInput.pasteBracketedText("   src/file.ts\n  literal $ARGUMENTS  ");
    ui.mockInput.pressEnter();
    expect(sent).toEqual(["/review   src/file.ts\n  literal $ARGUMENTS  "]);
    expect(input.plainText).toBe("");
    await ui.mockInput.typeText("/skills");
    ui.mockInput.pressEnter();
    expect(sent.at(-1)).toBe("/skills");
    await ui.mockInput.typeText("//literal");
    ui.mockInput.pressEnter();
    expect(sent.at(-1)).toBe("//literal");
  } finally { await ui.dispose(); }
});
