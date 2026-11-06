import type { TextareaRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { colors } from "../theme";

export function Composer(props: {
  busy: boolean;
  canSend: boolean;
  focused: boolean;
  onSubmit: (text: string) => void;
}) {
  let input: TextareaRenderable | undefined;
  const dimensions = useTerminalDimensions();
  const maxInputHeight = () => Math.max(1, Math.min(6, Math.floor(dimensions().height / 4)));
  const submit = () => {
    const text = input?.plainText.trim();
    if (!text || !props.canSend || props.busy) return;
    input?.setText("");
    props.onSubmit(text);
  };
  return (
    <box id="composer" flexDirection="row" backgroundColor={colors.surface}
      flexShrink={0} padding={1}>
      <text fg={props.focused ? colors.accent : colors.muted} width={2} flexShrink={0}>›</text>
      <textarea
        id="prompt" ref={value => { input = value; }} flexGrow={1} minWidth={0}
        height="auto" minHeight={1} maxHeight={maxInputHeight()} wrapMode="word"
        focused={props.focused}
        placeholder={props.busy ? "回复中，可继续编辑…" : "描述你的任务…"}
        placeholderColor={colors.muted}
        cursorColor={colors.foreground} selectionBg="#cddcff" selectionFg={colors.foreground}
        backgroundColor={colors.surface} focusedBackgroundColor={colors.surface}
        textColor={colors.foreground} focusedTextColor={colors.foreground}
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "return", shift: true, action: "newline" },
          { name: "j", ctrl: true, action: "newline" },
        ]}
        onSubmit={submit}
      />
    </box>
  );
}
