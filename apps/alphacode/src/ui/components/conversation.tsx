import { SyntaxStyle } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { Index, Show } from "solid-js";
import type { ChatMessage } from "../../chat/contracts";
import { colors, markdownStyles } from "../theme";
import { Welcome } from "./welcome";

export function Conversation(props: { messages: readonly ChatMessage[] }) {
  const syntaxStyle = SyntaxStyle.fromStyles(markdownStyles, useRenderer().nativeScene);
  return (
    <scrollbox id="conversation" width="100%" flexGrow={1} flexBasis={0} minHeight={0}
      stickyScroll stickyStart="bottom" scrollX={false} contentOptions={{ gap: 1, paddingRight: 1 }}
      scrollbarOptions={{ showArrows: false, trackOptions: { backgroundColor: colors.background, foregroundColor: colors.border } }}>
      <Welcome empty={props.messages.length === 0} />
      <Index each={props.messages}>{message => (
        <Show when={message().text || message().streaming}>
          <box flexDirection="row" flexShrink={0} paddingLeft={1} marginBottom={message().role === "tool" ? 0 : 1}>
            <text fg={message().role === "user" ? colors.accent : colors.muted} width={3} flexShrink={0}>
              {message().role === "user" ? "›" : message().role === "tool" ? "↳" : "●"}
            </text>
            <box flexDirection="column" flexGrow={1} minWidth={0}>
              <Show when={message().role === "assistant"} fallback={
                <text fg={message().role === "tool" ? colors.muted : colors.foreground}>
                  {message().text}{message().role === "tool" && message().note ? ` · ${message().note}` : ""}
                </text>
              }>
                <Show when={message().text} fallback={<text fg={colors.muted}>思考中…</text>}>
                  <markdown content={message().text} syntaxStyle={syntaxStyle} streaming={message().streaming ?? false} />
                </Show>
              </Show>
              <Show when={message().note && message().role !== "tool"}>
                <text fg={colors.muted} marginTop={1}>{message().note}</text>
              </Show>
            </box>
          </box>
        </Show>
      )}</Index>
    </scrollbox>
  );
}
