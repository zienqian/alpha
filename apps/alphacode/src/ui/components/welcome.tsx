import { Show } from "solid-js";
import { colors } from "../theme";

export function Welcome(props: { empty: boolean }) {
  return (
    <box flexDirection="column" flexShrink={0} gap={1} marginBottom={1} paddingLeft={1}>
      <box flexDirection="row" gap={1}>
        <text fg={colors.accent}><b>›_</b></text>
        <text fg={colors.foreground}><b>AlphaCode</b></text>
        <text fg={colors.muted}>代码，从这里开始。</text>
      </box>
      <Show when={props.empty}>
        <box flexDirection="column" gap={1} paddingLeft={3}>
          <text fg={colors.accent}>今天想一起构建什么？</text>
          <text fg={colors.muted}>理解项目、修复问题，或实现你的下一个想法。</text>
        </box>
      </Show>
    </box>
  );
}
