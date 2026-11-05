import { SyntaxStyle } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { Index, Show } from "solid-js";
import type { ChatMessage } from "../../chat/contracts";
import { colors, markdownStyles } from "../theme";

export function Conversation(props: { messages: readonly ChatMessage[] }) {
  const syntaxStyle = SyntaxStyle.fromStyles(markdownStyles, useRenderer().nativeScene);
  return (
    <scrollbox id="conversation" width="100%" flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" contentOptions={{ gap: 1 }}>
      <Index each={props.messages}>{message => (
        <Show when={message().text || message().streaming}>
          <box flexDirection="column" flexShrink={0} gap={0}>
            <text fg={message().role === "user" ? colors.accent : colors.muted}>
              {message().role === "user" ? "你" : message().role === "tool" ? "工具" : "AlphaCode"}
              {message().note ? ` · ${message().note}` : ""}
            </text>
            <Show when={message().role === "assistant"} fallback={<text fg={colors.foreground}>{message().text}</text>}>
              <Show when={message().text} fallback={<text fg={colors.muted}>思考中…</text>}>
                <markdown content={message().text} syntaxStyle={syntaxStyle} streaming={message().streaming ?? false} />
              </Show>
            </Show>
          </box>
        </Show>
      )}</Index>
    </scrollbox>
  );
}
