import { measureText } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { Show } from "solid-js";
import { colors } from "../theme";

export function Welcome() {
  const dimensions = useTerminalDimensions();
  const logoWidth = measureText({ text: "AlphaCode", font: "tiny" }).width;
  return (
    <box flexDirection="column" alignItems="center" flexShrink={0} marginBottom={1}>
      <Show when={dimensions().width >= logoWidth + 2} fallback={<text fg={colors.accent}><b>AlphaCode</b></text>}>
        <ascii_font font="tiny" text="AlphaCode" color={colors.accent} />
      </Show>
      <text fg={colors.muted}>What will you build?</text>
    </box>
  );
}
