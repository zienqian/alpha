import { For, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
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
  const dimensions = useTerminalDimensions();
  const compact = () => dimensions().width < 76;
  const options = () => props.permission ? permissionOptions : matchingCommands(props.query, props.skills);
  return (
    <box id="command-panel" flexDirection="column" flexShrink={0} marginBottom={1}>
      <Show when={props.permission}>
        <text fg={colors.muted} paddingX={1} height={1} truncate wrapMode="none">
          {props.settingsSaving ? "/permission · Saving…" : props.busy ? "/permission · Available after this task" : "/permission · Session · ↑↓ · Enter Apply · Esc Back"}
        </text>
      </Show>
      <For each={options()}>{(option, index) => (
        <box flexDirection="row" height={1} paddingX={1} gap={1}
          backgroundColor={index() === props.selected ? colors.selection : colors.background}>
          <text width={2} flexShrink={0} fg={colors.accent}>{index() === props.selected ? "›" : " "}</text>
          <text fg={colors.foreground} width={props.permission ? 24 : 16} minWidth={0} truncate wrapMode="none">
            {option.name}{"value" in option && option.value === props.currentMode ? " ✓" : ""}
          </text>
          <Show when={!compact()}>
            <text fg={colors.muted} flexGrow={1} minWidth={0} truncate wrapMode="none">{option.description}</text>
          </Show>
        </box>
      )}</For>
      <Show when={options().length === 0}>
        <text fg={colors.muted} paddingX={1} height={1} truncate wrapMode="none">No matching commands · Esc Back</text>
      </Show>
      <Show when={props.permission && compact()}>
        <text fg={colors.muted} paddingX={1} maxHeight={2}>
          {permissionOptions[props.selected]?.description}
        </text>
      </Show>
    </box>
  );
}
