import { useTranslation } from "../../i18n/react";
import type { Translate } from "../../i18n/instance";
import { presentStatus, presentToolDescription, presentToolOutput, presentToolError } from "../../i18n/presentation";
import { bold, fg, StyledText } from "@opentui/core";
import type { ToolRecord } from "@alpha/alphacode-app-server/contracts";
import { colors } from "../theme";
import { formatDuration } from "../duration";

export function toolVerb(t: Translate, tool: ToolRecord): string {
  switch (tool.status) {
    case "queued": return presentStatus(t, tool.status);
    case "running": return presentStatus(t, tool.status);
    case "awaiting_approval": return presentStatus(t, tool.status);
    case "failed": return tool.exitCode !== undefined ? t("tools:failedExit", { code: tool.exitCode }) : presentStatus(t, tool.status);
    case "denied": return presentStatus(t, tool.status);
    case "not_executed": return presentStatus(t, tool.status);
    case "outcome_unknown": return presentStatus(t, tool.status);
    case "succeeded": {
      const verbs = { run_command: "tools:verb.run_command", read_file: "tools:verb.read_file", edit_file: "tools:verb.edit_file", create_file: "tools:verb.create_file", search: "tools:verb.search", list_files: "tools:verb.list_files" } as const;
      return t(Object.hasOwn(verbs, tool.name) ? verbs[tool.name as keyof typeof verbs] : "tools:verb.other");
    }
  }
}

export function ToolRecordView(props: { tool: ToolRecord }) {
  const { t } = useTranslation();
  const header = new StyledText([bold(toolVerb(t, props.tool)), fg(colors.accent)(` ${props.tool.target}`)]);
  const color = () => props.tool.status === "succeeded" ? colors.success : props.tool.status === "failed" ? colors.error
    : props.tool.status === "outcome_unknown" || props.tool.status === "awaiting_approval" || props.tool.status === "denied" ? colors.warning
    : props.tool.status === "running" ? colors.accent : colors.muted;
  const footer = () => [
    props.tool.exitCode !== undefined ? t("tools:exit", { code: props.tool.exitCode }) : undefined,
    props.tool.startedAt !== undefined && props.tool.finishedAt !== undefined
      ? formatDuration(props.tool.finishedAt - props.tool.startedAt) : undefined,
    props.tool.output ? t("tools:preview") : undefined,
    props.tool.truncated ? t("tools:truncated") : undefined,
    props.tool.outputIncomplete ? t("tools:incomplete") : undefined,
  ].filter(Boolean).join(" · ");
  return (
    <box id={`tool-${props.tool.id}`} flexDirection="row" flexShrink={0} paddingLeft={1} marginBottom={1}>
      <text fg={color()} width={2} flexShrink={0}>•</text>
      <box flexDirection="column" flexGrow={1} minWidth={0}>
        <text content={header} height={1} truncate wrapMode="none" fg={colors.foreground} />
        <text fg={colors.muted} maxHeight={2} truncate>└ {presentToolDescription(t, props.tool)}</text>
        {props.tool.cwd && (
          <text fg={colors.muted} paddingLeft={2} height={1} truncate wrapMode="none">{t("tools:cwd", { path: props.tool.cwd })}</text>
        )}
        {props.tool.error && (
          <text fg={colors.error} paddingLeft={2} maxHeight={2} truncate>{presentToolError(t, props.tool)}</text>
        )}
        {props.tool.output && (
          <text fg={props.tool.status === "failed" ? colors.error : colors.muted} paddingLeft={2} maxHeight={8} truncate>{presentToolOutput(t, props.tool)}</text>
        )}
        {footer() && <text fg={colors.muted} paddingLeft={2} height={1} truncate wrapMode="none">{footer()}</text>}
      </box>
    </box>
  );
}
