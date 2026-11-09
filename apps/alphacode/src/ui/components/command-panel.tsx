import { useTranslation } from "../../i18n/react";
import { useTerminalDimensions } from "@opentui/react";
import type { ChatSkill, PermissionMode } from "../../chat/contracts";
import { matchingCommands, permissionOptions } from "../commands";
import { colors } from "../theme";

export function CommandPanel(props: {
  skills?: readonly ChatSkill[];
  query: string;
  permission: boolean;
  selected: number;
  currentMode: PermissionMode;
  busy: boolean;
  settingsSaving: boolean;
}) {
  const { t } = useTranslation();
  const dimensions = useTerminalDimensions();
  const compact = dimensions.width < 76;
  const options = props.permission ? permissionOptions.map(option => ({ ...option, name: t(option.name), description: t(option.description) })) : matchingCommands(props.query, props.skills, t);
  return (
    <box id="command-panel" flexDirection="column" flexShrink={0} marginBottom={1}>
      {props.permission && (
        <text fg={colors.muted} paddingX={1} height={1} truncate wrapMode="none">
          {props.settingsSaving ? t("permissions:saving") : props.busy ? t("permissions:busy") : t("permissions:hint")}
        </text>
      )}
      {options.map((option, index) => (
        <box key={option.name} flexDirection="row" height={1} paddingX={1} gap={1}
          backgroundColor={index === props.selected ? colors.selection : colors.background}>
          <text width={2} flexShrink={0} fg={colors.accent}>{index === props.selected ? "›" : " "}</text>
          <text fg={colors.foreground} width={props.permission ? 24 : 16} minWidth={0} truncate wrapMode="none">
            {option.name}{"value" in option && option.value === props.currentMode ? " ✓" : ""}
          </text>
          {!compact && (
            <text fg={colors.muted} flexGrow={1} minWidth={0} truncate wrapMode="none">{option.description}</text>
          )}
        </box>
      ))}
      {options.length === 0 && (
        <text fg={colors.muted} paddingX={1} height={1} truncate wrapMode="none">{t("chat:commands.empty")}</text>
      )}
      {props.permission && compact && (
        <text fg={colors.muted} paddingX={1} maxHeight={2}>
          {options[props.selected]?.description}
        </text>
      )}
    </box>
  );
}
