import { colors } from "../theme";

export function StatusBar(props: { modelId: string; workspaceRoot: string }) {
  return (
    <box id="status-bar" flexDirection="row" flexShrink={0} paddingX={1} gap={1} height={1}>
      <text id="model-info" fg={colors.model} maxWidth="40%" minWidth={0}
        height={1} truncate wrapMode="none">{props.modelId}</text>
      <text fg={colors.muted} flexShrink={0}>·</text>
      <text id="cwd-info" fg={colors.success} flexGrow={1} minWidth={0}
        height={1} truncate wrapMode="none">{props.workspaceRoot}</text>
    </box>
  );
}
