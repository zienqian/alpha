import type { TextareaRenderable } from "@opentui/core";
import { colors } from "../theme";

export function Composer(props: {
  busy: boolean;
  canSend: boolean;
  focused: boolean;
  onSubmit: (text: string) => void;
}) {
  let input: TextareaRenderable | undefined;
  const submit = () => {
    const text = input?.plainText.trim();
    if (!text || !props.canSend || props.busy) return;
    input?.setText("");
    props.onSubmit(text);
  };
  return (
    <box border borderStyle="rounded" borderColor={colors.border} height={5} flexShrink={0} paddingX={1}>
      <textarea
        id="prompt" ref={value => { input = value; }} flexGrow={1} height={3}
        focused={props.focused}
        placeholder={props.busy ? "可以继续编辑，当前回复结束后发送…" : "输入消息…"}
        backgroundColor={colors.background} focusedBackgroundColor={colors.background} textColor={colors.foreground}
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
