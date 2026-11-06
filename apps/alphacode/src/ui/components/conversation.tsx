import { SyntaxStyle } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { Index, Show, type Accessor } from "solid-js";
import type { ChatMessage, ToolRecord } from "../../chat/contracts";
import { colors, markdownStyles } from "../theme";
import { Welcome } from "./welcome";
import { ToolRecordView } from "./tool-record";
import { TurnCompletion } from "./turn-completion";

export function Conversation(props: { messages: readonly ChatMessage[] }) {
  const syntaxStyle = SyntaxStyle.fromStyles(markdownStyles, useRenderer().nativeScene);
  return (
    <scrollbox id="conversation" width="100%" flexGrow={1} flexBasis={0} minHeight={0}
      stickyScroll stickyStart="bottom" scrollX={false} contentOptions={{ gap: 1, paddingRight: 1 }}
      scrollbarOptions={{ showArrows: false, trackOptions: { backgroundColor: colors.background, foregroundColor: colors.border } }}>
      <Welcome empty={props.messages.length === 0} />
      <Index each={props.messages}>{message => (
        <Show when={message().text || message().completion}>
          <box flexDirection="column" flexShrink={0} marginBottom={message().tool ? 0 : 1}>
            <Show when={message().text}>
              <Show when={message().tool} fallback={
                <box id={`message-${message().id}`} flexDirection="row" flexShrink={0} paddingX={1}
                  paddingY={message().role === "user" ? 1 : 0}
                  backgroundColor={message().role === "user" ? colors.surface : undefined}>
                  <text fg={colors.muted} width={2} flexShrink={0}>
                    {message().role === "user" ? "›" : message().role === "tool" ? "↳" : "•"}
                  </text>
                  <box flexDirection="column" flexGrow={1} minWidth={0}>
                    <Show when={message().role === "assistant"} fallback={
                      <text fg={message().role === "tool" ? colors.muted : colors.foreground}>
                        {message().text}{message().role === "tool" && message().note ? ` · ${message().note}` : ""}
                      </text>
                    }>
                      <markdown content={message().text} syntaxStyle={syntaxStyle} streaming={message().streaming ?? false} />
                    </Show>
                    <Show when={message().note && message().role !== "tool"}>
                      <text fg={colors.muted} marginTop={1}>{message().note}</text>
                    </Show>
                  </box>
                </box>
              }>{(tool: Accessor<ToolRecord>) => <ToolRecordView tool={tool()} />}</Show>
            </Show>
            <Show when={message().completion}>{(completion: Accessor<NonNullable<ChatMessage["completion"]>>) => (
              <TurnCompletion id={message().id} completion={completion()} />
            )}</Show>
          </box>
        </Show>
      )}</Index>
    </scrollbox>
  );
}
