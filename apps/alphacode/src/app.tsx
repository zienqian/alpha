import { SyntaxStyle, type TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createSignal, Index, onCleanup, Show } from "solid-js";
import type { Chat } from "./chat";

export function App(props: { chat: Chat; onExit: () => void }) {
  const [state, setState] = createSignal(props.chat.state);
  onCleanup(props.chat.subscribe(setState));
  const renderer = useRenderer();
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: "#dce2ec" },
    "markup.heading": { fg: "#79c0ff", bold: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.raw": { fg: "#a5d6ff" },
    "markup.link": { fg: "#79c0ff", underline: true },
    "markup.list": { fg: "#79c0ff" },
    keyword: { fg: "#ff7b72" },
    string: { fg: "#a5d6ff" },
    comment: { fg: "#8b949e", italic: true },
    number: { fg: "#d2a8ff" },
    function: { fg: "#d2a8ff" },
    conceal: { fg: "#596579" },
  }, renderer.nativeScene);
  const approvalText = () => {
    const action = state().approval;
    const preview = action?.preview;
    return preview?.type === "command" ? `${preview.shell}\n${preview.cwd}\n${preview.command}` : action?.call.name ?? "";
  };
  let input: TextareaRenderable | undefined;
  const submit = () => {
    const text = input?.plainText.trim();
    if (!text || !state().canSend || state().busy) return;
    input?.setText("");
    void props.chat.send(text);
  };
  useKeyboard(key => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      if (state().busy) props.chat.cancel();
      else props.onExit();
    } else if (key.name === "escape" && state().busy) {
      key.preventDefault();
      props.chat.cancel();
    } else if (state().approval && (key.name === "y" || key.name === "n")) {
      key.preventDefault();
      props.chat.answerApproval(key.name === "y");
    }
  });
  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} gap={1} backgroundColor="#10151e">
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg="#79c0ff"><b>AlphaCode</b></text>
        <text fg="#8b949e">{props.chat.modelId}</text>
      </box>
      <text fg="#8b949e" flexShrink={0}>{props.chat.workspaceRoot}</text>
      <scrollbox id="conversation" flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" contentOptions={{ gap: 1 }}>
        <Show when={state().messages.length === 0}>
          <text fg="#8b949e">输入任务，开始对话。</text>
        </Show>
        <Index each={state().messages}>{message => (
          <Show when={message().text || message().streaming}>
            <box flexDirection="column" flexShrink={0} gap={0}>
              <text fg={message().role === "user" ? "#79c0ff" : "#8b949e"}>
                {message().role === "user" ? "你" : message().role === "tool" ? "工具" : "AlphaCode"}
                {message().note ? ` · ${message().note}` : ""}
              </text>
              <Show when={message().role === "assistant"} fallback={<text fg="#dce2ec">{message().text}</text>}>
                <Show when={message().text} fallback={<text fg="#8b949e">思考中…</text>}>
                  <markdown content={message().text} syntaxStyle={syntaxStyle} streaming={message().streaming ?? false} />
                </Show>
              </Show>
            </box>
          </Show>
        )}</Index>
      </scrollbox>
      <Show when={state().approval}>
        <box border borderColor="#d29922" flexDirection="column" paddingX={1} flexShrink={0} maxHeight={10}>
          <text fg="#d29922">允许执行此命令？ [y] 允许 / [n] 拒绝 / Esc 停止</text>
          <scrollbox maxHeight={6}>
            <text>{approvalText()}</text>
          </scrollbox>
        </box>
      </Show>
      <Show when={state().error}><text fg="#ff7b72" flexShrink={0}>{state().error}</text></Show>
      <box border borderStyle="rounded" borderColor="#36445a" height={5} flexShrink={0} paddingX={1}>
        <textarea
          id="prompt" ref={value => { input = value; }} flexGrow={1} height={3}
          focused={!state().approval && !state().closing}
          placeholder={state().busy ? "可以继续编辑，当前回复结束后发送…" : "输入消息…"}
          backgroundColor="#10151e" focusedBackgroundColor="#10151e" textColor="#dce2ec"
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
            { name: "j", ctrl: true, action: "newline" },
          ]}
          onSubmit={submit}
        />
      </box>
      <text fg="#8b949e" flexShrink={0}>{state().status} · Enter 发送 · Ctrl+J 换行 · Esc 停止 · Ctrl+C 退出</text>
    </box>
  );
}
