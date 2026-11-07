import { useTerminalDimensions } from "@opentui/solid";
import { formatWorkspacePath } from "../workspace-path";
import { colors } from "../theme";

export function StatusBar(props: { modelId: string; workspaceRoot: string; sessionTitle: string }) {
  const dimensions = useTerminalDimensions();
  const workspace = () => formatWorkspacePath(props.workspaceRoot);
  return (
    <box id="status-bar" flexDirection="row" flexShrink={0} paddingX={1} gap={1} height={1}>
      <text id="model-info" fg={colors.model} maxWidth={dimensions().width < 60 ? "25%" : "40%"} minWidth={0} flexShrink={1}
        height={1} truncate wrapMode="none">{props.modelId}</text>
      <text fg={colors.muted} flexShrink={0}>·</text>
      <text id="cwd-info" fg={colors.success} flexGrow={1} flexBasis={0} minWidth={0} maxWidth={Bun.stringWidth(workspace())}
        height={1} truncate wrapMode="none">{workspace()}</text>
      <text fg={colors.muted} flexShrink={0}>·</text>
      <text id="session-title" fg={colors.muted} flexShrink={1} minWidth={0} maxWidth={dimensions().width < 60 ? "35%" : "40%"}
        height={1} truncate wrapMode="none">{props.sessionTitle}</text>
    </box>
  );
}
