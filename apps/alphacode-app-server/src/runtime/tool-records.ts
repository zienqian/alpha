import { stripVTControlCharacters } from "node:util";
import type { ToolResultMessage } from "@alpha/adk/core";
import type { ToolRecord } from "../chat/contracts";

interface Call { id: string; name: string; arguments: Readonly<Record<string, unknown>> }
const codingTools = new Set(["run_command", "read_file", "edit_file", "create_file", "search", "list_files", "readSkill", "read_context"]);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function plain(value: string): string {
  // Only the preview is sanitized; canonical arguments and approval commands are untouched.
  return stripVTControlCharacters(value).replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex -- Tool previews must not emit terminal control bytes.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "");
}

export function displayText(value: unknown, limit = 160): string {
  if (typeof value !== "string") return "";
  const text = plain(value).replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : text;
}

export function createToolRecord(assistantId: string, call: Call): ToolRecord {
  const name = displayText(call.name, 80), args = call.arguments;
  const command = call.name === "run_command" ? displayText(args.command, 512) : undefined;
  const path = displayText(args.path, 256) || undefined;
  const target = command || (call.name === "search" ? displayText(args.query, 256) : call.name === "readSkill" ? displayText(args.name, 64) : path) || name;
  const fallback = call.name === "run_command" ? `Run command: ${command || name}`
    : call.name === "read_file" ? `Read file: ${path || "file"}`
    : call.name === "readSkill" ? `Read skill: ${target}`
    : call.name === "edit_file" ? `Edit file: ${path || "file"}`
    : call.name === "create_file" ? `Create file: ${path || "file"}`
    : call.name === "search" ? `Search: ${target}`
    : call.name === "list_files" ? `List files: ${path || "."}` : `Run tool: ${name}`;
  const description = displayText(args.description);
  return {
    id: `${assistantId}:${call.id}`, assistantId, callId: call.id, name, target,
    description: description || displayText(fallback), descriptionSource: description ? "model" : "fallback",
    command, path, cwd: displayText(args.cwd, 256) || undefined, status: "queued",
  };
}

function preview(text: string): Pick<ToolRecord, "output" | "outputLines" | "omittedLines" | "truncated"> {
  const lines = plain(text).trimEnd().split("\n");
  const omittedLines = lines.length > 8 ? lines.length - 7 : 0;
  const selected = omittedLines ? [...lines.slice(0, 4), `… ${omittedLines} lines omitted …`, ...lines.slice(-3)] : lines;
  let clipped = false;
  const output = selected.map(line => {
    const chars = Array.from(line.replace(/\t/g, "  "));
    if (chars.length <= 240) return chars.join("");
    clipped = true;
    return `${chars.slice(0, 239).join("")}…`;
  }).join("\n");
  const outputLines = output.split("\n");
  if (omittedLines) outputLines.splice(4, 1);
  return { output, outputLines, omittedLines, truncated: clipped };
}

function codingOutput(name: string, data: Record<string, unknown>): string {
  if (name === "run_command") return [
    typeof data.stdout === "string" ? data.stdout.trimEnd() : "",
    typeof data.stderr === "string" && data.stderr ? `stderr:\n${data.stderr.trimEnd()}` : "",
  ].filter(Boolean).join("\n");
  if ((name === "read_file" || name === "read_context") && typeof data.content === "string") return data.content;
  if (name === "edit_file" && data.changed === true) return "File updated.";
  if (name === "create_file" && data.created === true) return "File created.";
  return JSON.stringify(data, null, 2);
}

export function completeToolRecord(tool: ToolRecord, result: Pick<ToolResultMessage, "content" | "execution">): ToolRecord {
  const record: ToolRecord = { ...tool, status: result.execution };
  let output = result.content;
  if (codingTools.has(tool.name) && result.execution === "succeeded") {
    let value: unknown;
    try { value = JSON.parse(result.content); } catch { /* Invalid known-tool results cannot imply success. */ }
    if (!isObject(value) || typeof value.ok !== "boolean") {
      record.status = "outcome_unknown";
      record.error = "Invalid tool result";
      record.errorCode = "INVALID_TOOL_RESULT";
    } else {
      const data = value.ok ? value.data : value.detail;
      record.status = value.ok ? "succeeded" : "failed";
      if (!value.ok) { record.error = displayText(value.code) || "Tool reported failure"; record.errorCode = displayText(value.code) || "TOOL_FAILED"; }
      if (isObject(data)) {
        output = codingOutput(tool.name, data);
        if (value.ok && tool.name === "edit_file" && data.changed === true) record.summaryCode = "FILE_UPDATED";
        if (value.ok && tool.name === "create_file" && data.created === true) record.summaryCode = "FILE_CREATED";
        record.truncated = data.truncated === true || (tool.name === "read_context" && data.hasMore === true);
        record.outputIncomplete = data.outputIncomplete === true || (tool.name === "read_context" && data.complete === false);
        if (typeof data.exitCode === "number" && Number.isInteger(data.exitCode)) {
          record.exitCode = data.exitCode;
          if (data.exitCode !== 0) record.status = "failed";
        }
      } else output = record.error || "";
      if (tool.name === "run_command" && value.ok && record.exitCode === undefined) {
        record.status = "outcome_unknown";
        record.error = "Command exit code unavailable";
        record.errorCode = "COMMAND_EXIT_UNAVAILABLE";
      }
    }
  }
  const limited = preview(output);
  return { ...record, ...limited, truncated: record.truncated || limited.truncated };
}
