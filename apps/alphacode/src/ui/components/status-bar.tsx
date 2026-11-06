import { useTerminalDimensions } from "@opentui/solid";
import type { PermissionMode } from "../../chat/contracts";
import { permissionOptions } from "../commands";
import { colors } from "../theme";

const compactPermissions: Record<PermissionMode, string> = { ask: "Ask", auto: "Auto", full: "Full" };

export function StatusBar(props: { modelId: string; workspaceRoot: string; permissionMode: PermissionMode }) {
  const dimensions = useTerminalDimensions();
  const permission = () => dimensions().width < 60 ? compactPermissions[props.permissionMode]
    : permissionOptions.find(option => option.value === props.permissionMode)?.name;
  return (
    <box id="status-bar" flexDirection="row" flexShrink={0} paddingX={1} gap={1} height={1}>
      <text id="model-info" fg={colors.model} maxWidth={dimensions().width < 60 ? "25%" : "40%"} minWidth={0} flexShrink={1}
        height={1} truncate wrapMode="none">{props.modelId}</text>
      <text fg={colors.muted} flexShrink={0}>·</text>
      <text id="cwd-info" fg={colors.success} flexGrow={1} flexBasis={0} minWidth={0} maxWidth={Bun.stringWidth(props.workspaceRoot)}
        height={1} truncate wrapMode="none">{props.workspaceRoot}</text>
      <text fg={colors.muted} flexShrink={0}>·</text>
      <text id="permission-info" fg={colors.muted} flexShrink={0}
        height={1} wrapMode="none">{permission()}</text>
    </box>
  );
}
