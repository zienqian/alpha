import { createEffect, Show } from "solid-js";
import { bold, fg, StyledText, type TextRenderable } from "@opentui/core";
import type { ToolRecord } from "../../chat/contracts";
import { colors } from "../theme";
import { formatDuration } from "../duration";

export function toolVerb(tool: ToolRecord): string {
  switch (tool.status) {
    case "queued": return "Queued";
    case "running": return "Running";
    case "awaiting_approval": return "Awaiting approval";
    case "failed": return tool.exitCode !== undefined ? `Failed (exit ${tool.exitCode})` : "Failed";
    case "denied": return "Denied";
    case "not_executed": return "Not executed";
    case "outcome_unknown": return "Result unconfirmed";
    case "succeeded": return ({ run_command: "Ran", read_file: "Read", edit_file: "Edited", create_file: "Created", search: "Searched", list_files: "Listed" } as Record<string, string>)[tool.name] ?? "Used";
  }
}

export function ToolRecordView(props: { tool: ToolRecord }) {
  let header: TextRenderable | undefined;
  // OpenTUI Solid 0.8 coerces the JSX content prop to a string; keep styled chunks on the native text node.
  createEffect(() => {
    const content = new StyledText([bold(toolVerb(props.tool)), fg(colors.accent)(` ${props.tool.target}`)]);
    if (header) header.content = content;
  });
  const color = () => props.tool.status === "succeeded" ? colors.success : props.tool.status === "failed" ? colors.error
    : props.tool.status === "outcome_unknown" || props.tool.status === "awaiting_approval" || props.tool.status === "denied" ? colors.warning
    : props.tool.status === "running" ? colors.accent : colors.muted;
  const footer = () => [
    props.tool.exitCode !== undefined ? `exit ${props.tool.exitCode}` : undefined,
    props.tool.startedAt !== undefined && props.tool.finishedAt !== undefined
      ? formatDuration(props.tool.finishedAt - props.tool.startedAt) : undefined,
    props.tool.output ? "Output preview (up to 8 rows)" : undefined,
    props.tool.truncated ? "Truncated" : undefined,
    props.tool.outputIncomplete ? "Output incomplete" : undefined,
  ].filter(Boolean).join(" · ");
  return (
    <box id={`tool-${props.tool.id}`} flexDirection="row" flexShrink={0} paddingLeft={1} marginBottom={1}>
      <text fg={color()} width={2} flexShrink={0}>•</text>
      <box flexDirection="column" flexGrow={1} minWidth={0}>
        <text ref={value => { header = value; }} height={1} truncate wrapMode="none" fg={colors.foreground} />
        <text fg={colors.muted} maxHeight={2} truncate>└ {props.tool.description}</text>
        <Show when={props.tool.cwd}>
          <text fg={colors.muted} paddingLeft={2} height={1} truncate wrapMode="none">cwd: {props.tool.cwd}</text>
        </Show>
        <Show when={props.tool.error}>
          <text fg={colors.error} paddingLeft={2} maxHeight={2} truncate>{props.tool.error}</text>
        </Show>
        <Show when={props.tool.output}>
          <text fg={props.tool.status === "failed" ? colors.error : colors.muted} paddingLeft={2} maxHeight={8} truncate>{props.tool.output}</text>
        </Show>
        <Show when={footer()}><text fg={colors.muted} paddingLeft={2} height={1} truncate wrapMode="none">{footer()}</text></Show>
      </box>
    </box>
  );
}
