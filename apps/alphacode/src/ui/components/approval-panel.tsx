import type { ApprovalRequest } from "../../chat/contracts";
import { colors } from "../theme";

export function ApprovalPanel(props: { request: ApprovalRequest }) {
  const text = () => {
    const preview = props.request.preview;
    return preview.type === "command" ? `${preview.shell}\n${preview.cwd}\n${preview.command}` : props.request.name;
  };
  return (
    <box border borderColor={colors.warning} flexDirection="column" paddingX={1} flexShrink={0} maxHeight={10}>
      <text fg={colors.warning}>允许执行此命令？ [y] 允许 / [n] 拒绝 / Esc 停止</text>
      <scrollbox maxHeight={6}><text>{text()}</text></scrollbox>
    </box>
  );
}
