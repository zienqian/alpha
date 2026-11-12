import { useTranslation } from "../../i18n/react";
import { presentNote, presentLocalResult } from "../../i18n/presentation";
import { SyntaxStyle } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useLayoutEffect, useState } from "react";
import type { ChatMessage } from "@alpha/alphacode-app-server/contracts";
import { colors, markdownStyles } from "../theme";
import { Welcome } from "./welcome";
import { ToolRecordView } from "./tool-record";
import { TurnCompletion } from "./turn-completion";

export function Conversation(props: { messages: readonly ChatMessage[] }) {
  const { t } = useTranslation();
  const renderer = useRenderer();
  const [syntaxStyle, setSyntaxStyle] = useState<SyntaxStyle>();
  useLayoutEffect(() => {
    const style = SyntaxStyle.fromStyles(markdownStyles, renderer.nativeScene);
    setSyntaxStyle(style);
    return () => style.destroy();
  }, [renderer]);
  return (
    <scrollbox id="conversation" width="100%" flexGrow={1} flexBasis={0} minHeight={0}
      stickyScroll stickyStart="bottom" scrollX={false} contentOptions={{ gap: 1, paddingRight: 1 }}
      scrollbarOptions={{ showArrows: false, trackOptions: { backgroundColor: colors.background, foregroundColor: colors.border } }}>
      <Welcome empty={props.messages.length === 0} />
      {props.messages.map(message => (message.text || message.completion) ? (
        <box key={message.id} flexDirection="column" flexShrink={0} marginBottom={message.tool ? 0 : 1}>
          {message.text && (message.tool ? <ToolRecordView tool={message.tool} /> : (
            <box id={`message-${message.id}`} flexDirection="row" flexShrink={0} paddingX={1}
              paddingY={message.role === "user" ? 1 : 0}
              backgroundColor={message.role === "user" ? colors.surface : undefined}>
              <text fg={colors.muted} width={2} flexShrink={0}>
                {message.role === "user" ? "›" : message.role === "tool" ? "↳" : "•"}
              </text>
              <box flexDirection="column" flexGrow={1} minWidth={0}>
                {message.role === "assistant" ? syntaxStyle && (
                  <markdown content={message.localResult ? presentLocalResult(t, message.localResult) : message.text} syntaxStyle={syntaxStyle} streaming={message.streaming ?? false} />
                ) : (
                  <text fg={message.role === "tool" ? colors.muted : colors.foreground}>
                    {message.text}{message.role === "tool" && message.note ? ` · ${presentNote(t, message)}` : ""}
                  </text>
                )}
                {message.note && message.role !== "tool" && <text fg={colors.muted} marginTop={1}>{presentNote(t, message)}</text>}
              </box>
            </box>
          ))}
          {message.completion && <TurnCompletion id={message.id} completion={message.completion} />}
        </box>
      ) : null)}
    </scrollbox>
  );
}
