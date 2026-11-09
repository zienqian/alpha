import { colors } from "../theme";

export function Welcome(props: { empty: boolean }) {
  return (
    <box flexDirection="column" flexShrink={0} gap={1} marginBottom={1} paddingLeft={1}>
      <box flexDirection="row" gap={1}>
        <text fg={colors.accent}><b>›_</b></text>
        <text fg={colors.foreground}><b>AlphaCode</b></text>
        <text fg={colors.muted}>Code starts here.</text>
      </box>
      {props.empty && (
        <box flexDirection="column" gap={1} paddingLeft={3}>
          <text fg={colors.accent}>What would you like to build?</text>
          <text fg={colors.muted}>Explore a project, fix a bug, or build something new.</text>
        </box>
      )}
    </box>
  );
}
