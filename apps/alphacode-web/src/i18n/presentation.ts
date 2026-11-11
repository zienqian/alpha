import type { Translate } from "./instance";

export interface Notice { code: string; params?: Record<string, string | number> }
export interface LocalResult {
  kind: "skills" | "permission";
  skills?: readonly { name: string; description: string; argumentHint?: string; userInvocable: boolean; disableModelInvocation?: boolean }[];
  diagnostics?: readonly { severity: string; code: string; path: string; field?: string }[];
}
const outcomes = {
  completed: "chat:outcome.completed", refused: "chat:outcome.refused", incomplete: "chat:outcome.incomplete",
  unknown: "chat:outcome.unknown", limited: "chat:outcome.limited", cancelled: "chat:outcome.cancelled", failed: "chat:outcome.failed",
} as const;
const statuses = {
  queued: "tools:status.queued", running: "tools:status.running", awaiting_approval: "tools:status.awaiting_approval",
  succeeded: "tools:status.succeeded", failed: "tools:status.failed", denied: "tools:status.denied",
  not_executed: "tools:status.not_executed", outcome_unknown: "tools:status.outcome_unknown",
} as const;
export function presentStatus(t: Translate, code: string) {
  return Object.hasOwn(statuses, code) ? t(statuses[code as keyof typeof statuses]) : code;
}
export function presentNote(t: Translate, message: { note?: string; noteCode?: string; tool?: { status: string } }) {
  if (message.tool) return presentStatus(t, message.tool.status);
  if (message.noteCode === "INCOMPLETE_PREVIEW") return t("chat:note.preview");
  if (message.noteCode === "RESPONSE_INCOMPLETE") return t("chat:note.incomplete");
  if (message.noteCode === "RESPONSE_STEERED") return t("chat:note.steered");
  if (message.noteCode && Object.hasOwn(outcomes, message.noteCode)) return t(outcomes[message.noteCode as keyof typeof outcomes]);
  return message.note ?? "";
}
export function presentNotice(t: Translate, notice?: Notice, fallback = "") {
  if (!notice) return fallback;
  switch (notice.code) {
    case "SESSION_UNSAVED": return t("errors:unsaved");
    case "EXECUTION_UNCONFIRMED": return t("errors:blocked");
    case "PERMISSION_SAVE_FAILED": return t("errors:permissionSave", { code: notice.params?.cause ?? "UNEXPECTED_ERROR" });
    case "EXIT_FAILED": return t("errors:exit");
    case "OPEN_BROWSER": return t("errors:openBrowser", { url: notice.params?.url ?? "" });
    case "SERVER_DISCONNECTED": case "SERVER_UNAVAILABLE": return t("errors:disconnected");
    default: return t("errors:generic", { code: notice.code });
  }
}
interface DisplayTool {
  name: string; description: string; descriptionSource?: string; target?: string; path?: string; command?: string;
  output?: string; summaryCode?: string; outputLines?: readonly string[]; omittedLines?: number;
  error?: string; errorCode?: string;
}
const descriptions = {
  run_command: "tools:description.command", read_file: "tools:description.read", edit_file: "tools:description.edit",
  create_file: "tools:description.create", search: "tools:description.search", list_files: "tools:description.list", readSkill: "tools:description.skill",
} as const;
export function presentToolDescription(t: Translate, tool: DisplayTool) {
  if (tool.descriptionSource !== "fallback") return tool.description || tool.name;
  const key = Object.hasOwn(descriptions, tool.name) ? descriptions[tool.name as keyof typeof descriptions] : "tools:description.other";
  return t(key, { target: tool.target || tool.command || tool.path || tool.name });
}
export function presentToolOutput(t: Translate, tool: DisplayTool) {
  if (tool.summaryCode === "FILE_UPDATED") return t("tools:result.updated");
  if (tool.summaryCode === "FILE_CREATED") return t("tools:result.created");
  if (!tool.outputLines) return tool.output ?? "";
  const lines = [...tool.outputLines];
  if (tool.omittedLines) lines.splice(4, 0, t("tools:omission", { count: tool.omittedLines }));
  return lines.join("\n");
}
export function presentToolError(t: Translate, tool: DisplayTool) {
  switch (tool.errorCode) {
    case "INVALID_TOOL_RESULT": return t("tools:invalidResult");
    case "COMMAND_EXIT_UNAVAILABLE": return t("tools:missingExit");
    case "TOOL_FAILED": return t("tools:reportedFailure");
    default: return tool.error ?? "";
  }
}
export function presentLocalResult(t: Translate, result: LocalResult) {
  if (result.kind === "permission") return t("skills:permissionHint");
  return [t("skills:title"), ...(result.skills ?? []).map(skill =>
    `/${skill.name}${skill.argumentHint ? ` ${skill.argumentHint}` : ""} — ${skill.description}${!skill.userInvocable ? ` (${t("skills:modelOnly")})` : skill.disableModelInvocation ? ` (${t("skills:manualOnly")})` : ""}`),
    ...(!result.skills?.length ? [t("skills:none")] : []),
    ...(result.diagnostics ?? []).map(d => `${d.severity}: ${d.code} — ${d.path}${d.field ? ` (${d.field})` : ""}`),
    t("skills:configure")].join("\n");
}
