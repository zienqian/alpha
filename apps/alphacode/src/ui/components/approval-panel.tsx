import type { ApprovalRequest } from "../../chat/contracts";
import { colors } from "../theme";
import { useTranslation } from "../../i18n/react";

export function ApprovalPanel(props: { request: ApprovalRequest; maxHeight: number }) {
  const { t } = useTranslation();
  const text = () => {
    const preview = props.request.preview;
    return preview.type === "command" ? `${preview.shell}\n${preview.cwd}\n${preview.command}` : props.request.name;
  };
  return (
    <box border borderStyle="rounded" borderColor={colors.border} flexDirection="column"
      paddingX={1} flexShrink={0} maxHeight={props.maxHeight} marginBottom={1}>
      <text fg={colors.warning} flexShrink={0}>{t(props.request.preview.type === "command" ? "permissions:approveCommand" : "permissions:approveTool")}</text>
      <scrollbox minHeight={1} maxHeight={Math.max(1, props.maxHeight - 4)}>
        <text fg={colors.foreground}>{text()}</text>
      </scrollbox>
    </box>
  );
}
