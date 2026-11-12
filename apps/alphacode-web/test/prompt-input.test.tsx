import { useState, type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor, within } from "./render";
import { describe, expect, it, vi } from "vitest";
import { PromptInput } from "@/components/ai-elements/prompt-input";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";
import { replaceDraft } from "./fixtures/draft-editor";

function Composer(props: Partial<ComponentProps<typeof PromptInput>>) {
  const [draft, setDraft] = useState<SessionDraft>({ text: "", attachments: [] });
  return <PromptInput draft={draft} onChange={patch => setDraft(previous => ({ ...previous, ...patch }))}
    onSend={() => undefined} canSend={Boolean(draft.text.trim())} busy={false} onCancel={() => undefined}
    canCancel={false} status="" onPermissionChange={() => undefined} canChangePermission={false} permissionSaving={false}
    {...props} />;
}

const input = () => screen.getByRole("textbox", { name: "消息草稿" });

describe("Markdown rich-text composer", () => {
  it("renders pasted Markdown in the editable field and serializes it for sending", () => {
    const changed = vi.fn();
    render(<Composer onChange={changed} />);
    const source = ["# 任务", "**加粗**和 `code`", "- 第一项\n- 第二项", "- [x] 完成", "| 名称 | 状态 |\n| --- | --- |\n| 文档 | 就绪 |", "```ts\nconst ready = true;\n```"].join("\n\n");
    replaceDraft(input(), source);
    expect(input().getAttribute("contenteditable")).toBe("true");
    expect(within(input()).getByRole("heading", { name: "任务" })).toBeTruthy();
    expect(input().querySelector("strong")?.textContent).toBe("加粗");
    expect(within(input()).getByRole("cell", { name: "就绪" })).toBeTruthy();
    expect(input().querySelector("pre code")?.textContent).toBe("const ready = true;");
    expect((within(input()).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    const markdown = changed.mock.lastCall?.[0].text as string;
    expect(markdown).toContain("# 任务");
    expect(markdown).toContain("**加粗**");
    expect(markdown).toContain("- [x] 完成");
    expect(markdown).toContain("```ts\nconst ready = true;\n```");
    expect(screen.queryByRole("button", { name: "预览 Markdown" })).toBeNull();
  });

  it("preserves pasted HTML as safe text and disallows executable links", () => {
    render(<Composer />);
    replaceDraft(input(), '<script>alert(1)</script>\n\n未发送 <draft>\n\n<strong>HTML 源码</strong>\n\n[unsafe](javascript:alert%281%29)');
    expect(input().querySelector("script")).toBeNull();
    expect(input().textContent).toContain("未发送 <draft>");
    expect(input().textContent).toContain("<strong>HTML 源码</strong>");
    expect(input().querySelector("strong")).toBeNull();
    expect(input().querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("sends on Enter while Shift+Enter continues a list and IME confirmation does not send", () => {
    const send = vi.fn();
    render(<Composer onSend={send} />);
    replaceDraft(input(), "- 第一项");
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(input().querySelectorAll("li")).toHaveLength(2);
    const beforeComposition = input().innerHTML;
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    expect(input().innerHTML).toBe(beforeComposition);
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("keeps code pastes literal, and Shift+Enter inserts a code newline", () => {
    const changed = vi.fn();
    render(<Composer onChange={changed} />);
    replaceDraft(input(), "```ts\nconst ready = true;\n```");
    fireEvent.paste(input(), { clipboardData: { getData: () => "**literal**" } });
    expect(input().querySelector("strong")).toBeNull();
    expect(input().querySelector("pre")?.textContent).toContain("**literal**");
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(input().querySelector("pre")?.textContent).toContain("\n");
  });

  it("preserves formatting when pasting a selection copied from the rich editor", () => {
    render(<Composer />);
    fireEvent.paste(input(), { clipboardData: { getData: (type: string) => type === "text/html"
      ? '<p data-pm-slice="1 1 []"><strong>保留样式</strong></p>' : type === "text/plain" ? "保留样式" : "" } });
    expect(input().querySelector("strong")?.textContent).toBe("保留样式");
  });

  it("preserves selection and undo on parent rerenders, but clears history after an accepted send", () => {
    const { rerender } = render(<Composer />);
    replaceDraft(input(), "保留内容");
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const offset = selection?.anchorOffset;
    expect(anchor).toBeTruthy();
    rerender(<Composer status="正在连接" />);
    expect(selection?.anchorNode).toBe(anchor);
    expect(selection?.anchorOffset).toBe(offset);
    fireEvent.keyDown(input(), { key: "z", ctrlKey: true });
    expect(input().textContent).toBe("");
    replaceDraft(input(), "发送的内容");
    rerender(<Composer draft={{ text: "", attachments: [] }} />);
    expect(input().textContent).toBe("");
    fireEvent.keyDown(input(), { key: "z", ctrlKey: true });
    expect(input().textContent).toBe("");
  });

  it("restores formatted drafts and honors explicit focus requests", async () => {
    const { rerender } = render(<Composer draft={{ text: "# 已保存的草稿", attachments: [] }} />);
    expect(within(input()).getByRole("heading", { name: "已保存的草稿" })).toBeTruthy();
    rerender(<Composer draft={{ text: "**切换后的草稿**", attachments: [] }} focusRequest={1} />);
    await waitFor(() => expect(document.activeElement).toBe(input()));
    expect(input().querySelector("strong")?.textContent).toBe("切换后的草稿");
  });
});
