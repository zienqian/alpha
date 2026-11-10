import type { Message } from "@alpha/adk/core";
import type {
  TraceSnapshot,
  TraceHealth,
  TraceView,
  TraceViewStep,
  TraceStepDetail,
  TraceLaneSegment,
  TraceSpan,
} from "@alpha/adk-trace/contracts";

const textLimit = 16000;
const messageIndexes = new WeakMap<
  readonly Message[],
  { byId: Map<string, Message>; results: Map<string, Message> }
>();
const snapshotIndexes = new WeakMap<
  TraceSnapshot,
  { spans: Map<string, TraceSpan>; messages: Set<string> }
>();
function index(messages: readonly Message[]) {
  let value = messageIndexes.get(messages);
  if (!value) {
    value = {
      byId: new Map(messages.map((m) => [m.id, m])),
      results: new Map(
        messages.flatMap((m) =>
          m.role === "toolResult"
            ? [[JSON.stringify([m.assistantId, m.callId]), m]]
            : [],
        ),
      ),
    };
    messageIndexes.set(messages, value);
  }
  return value;
}
function snapshotIndex(snapshot: TraceSnapshot) {
  let value = snapshotIndexes.get(snapshot);
  if (!value) {
    value = {
      spans: new Map(snapshot.spans.map((s) => [s.spanId, s])),
      messages: new Set(snapshot.messages.map((m) => m.messageId)),
    };
    snapshotIndexes.set(snapshot, value);
  }
  return value;
}
/** Applied to every preview/copy response. No content is written into the Trace DB. */
export function redactTraceText(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[\w.+/=-]+/gi, "$1[REDACTED]")
    .replace(
      /\b(sk-[\w-]{12,}|gh[pousr]_[\w]{16,}|AKIA[0-9A-Z]{16})\b/g,
      "[REDACTED]",
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|secret|authorization)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
      "$1[REDACTED]",
    );
}
function safe(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string")
    return redactTraceText(value).slice(0, textLimit);
  if (Array.isArray(value))
    return value.slice(0, 100).map((v) => safe(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([k, v]) => [
          k,
          /token|password|secret|authorization|api.?key/i.test(k)
            ? "[REDACTED]"
            : safe(v, depth + 1),
        ]),
    );
  return value;
}
const content = (value: string | undefined) =>
  redactTraceText(value ?? "").slice(0, textLimit);
function callFor(span: TraceSpan, messages: readonly Message[]) {
  const assistant = span.assistantId
    ? index(messages).byId.get(span.assistantId)
    : undefined;
  return assistant?.role === "assistant"
    ? assistant.toolCalls.find((c) => c.id === span.callId)
    : undefined;
}
function toolOutput(
  span: TraceSpan,
  messages: readonly Message[],
): string | undefined {
  const result = index(messages).results.get(
    JSON.stringify([span.assistantId, span.callId]),
  );
  if (result?.role !== "toolResult") return;
  try {
    const parsed = JSON.parse(result.content);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.ok === "boolean"
    ) {
      const data = parsed.ok ? parsed.data : parsed.detail;
      if (span.name === "run_command" && data)
        return [
          data.stdout,
          data.stderr && `stderr:\n${data.stderr}`,
          data.exitCode !== undefined && `exitCode: ${data.exitCode}`,
        ]
          .filter((v) => typeof v === "string" && v)
          .join("\n");
      if (span.name === "read_file" && typeof data?.content === "string")
        return data.content;
    }
  } catch {
    /* Generic tools need not return JSON. */
  }
  return result.content;
}
function normalizedInput(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const clean = safe(input) as Record<string, unknown>;
  // Presenter's diff contract differs from Alpha's coding-tool argument names.
  if (typeof clean.oldText === "string") {
    clean.old_string = clean.oldText;
    clean.new_string = clean.newText;
    delete clean.oldText;
    delete clean.newText;
  }
  const encoded = JSON.stringify(clean);
  return encoded.length <= textLimit
    ? clean
    : { preview: encoded.slice(0, textLimit), truncated: true };
}
function shape(
  input: Readonly<Record<string, unknown>> | undefined,
): TraceViewStep["shape"] {
  if (!input) return "other";
  if (typeof input.command === "string") return "command";
  if (typeof input.oldText === "string" || typeof input.content === "string")
    return "write";
  if (typeof input.query === "string" || typeof input.pattern === "string")
    return "search";
  if (typeof input.path === "string" || typeof input.file_path === "string")
    return "read";
  return "other";
}
function lanes(
  spans: TraceSpan[],
  kind: "model" | "tool",
  messages: readonly Message[],
): TraceLaneSegment[] {
  const merged: TraceLaneSegment[] = [];
  const intervals = spans
    .filter(
      (s) =>
        s.kind === kind &&
        s.startOffsetMs !== null &&
        s.endOffsetMs !== null &&
        s.endOffsetMs > s.startOffsetMs,
    )
    .sort((a, b) => a.startOffsetMs! - b.startOffsetMs!);
  for (const s of intervals) {
    const startMs = s.startOffsetMs!,
      end = s.endOffsetMs!;
    const reply = s.assistantId
      ? index(messages).byId.get(s.assistantId)
      : undefined;
    const tone =
      s.status === "error"
        ? "error"
        : kind === "tool"
          ? "tool"
          : reply?.role === "assistant" &&
              !reply.toolCalls.length &&
              reply.text.trim()
            ? "report"
            : "think";
    const previous = merged.at(-1);
    if (
      previous &&
      previous.startMs + previous.durationMs >= startMs &&
      previous.kind === tone
    )
      previous.durationMs =
        Math.max(end, previous.startMs + previous.durationMs) -
        previous.startMs;
    else merged.push({ startMs, durationMs: end - startMs, kind: tone });
  }
  return merged;
}
export function buildTraceView(
  snapshot: TraceSnapshot,
  messages: readonly Message[],
  health: TraceHealth,
  workspace?: string,
): TraceView {
  const { summary, spans } = snapshot;
  const steps: TraceViewStep[] = [];
  let commands = 0,
    added = 0,
    removed = 0;
  const files = new Set<string>();
  for (const span of spans) {
    if (
      span.kind !== "tool" &&
      !(
        span.kind === "model" &&
        (span.status === "running" || span.status === "error")
      )
    )
      continue;
    const call = callFor(span, messages),
      input = call?.arguments;
    const form = shape(input);
    const preview = input
      ? [
          input.command,
          input.path,
          input.file_path,
          input.query,
          input.pattern,
          input.name,
        ].find((v) => typeof v === "string")
      : undefined;
    steps.push({
      stepId: span.spanId,
      spanId: span.spanId,
      seq: span.seq,
      kind:
        span.kind === "tool"
          ? "call"
          : span.status === "error"
            ? "error"
            : "model",
      label: span.name,
      summary: content(typeof preview === "string" ? preview : span.errorCode)
        .replace(/\s+/g, " ")
        .slice(0, 512),
      offsetMs: span.startOffsetMs ?? span.observedOffsetMs,
      durationMs: span.durationMs,
      status: span.status,
      shape: form,
      detailState: call || span.kind === "model" ? "available" : "not_captured",
    });
    if (form === "command") commands++;
    if (
      form === "write" &&
      span.status === "ok" &&
      typeof input?.path === "string"
    ) {
      files.add(input.path);
      if (
        typeof input.oldText === "string" &&
        typeof input.newText === "string"
      ) {
        // Same line-diff convention as the reference; matching prefix/suffix are context.
        const before = input.oldText.split("\n"),
          after = input.newText.split("\n");
        while (before.length && after.length && before[0] === after[0]) {
          before.shift();
          after.shift();
        }
        while (
          before.length &&
          after.length &&
          before.at(-1) === after.at(-1)
        ) {
          before.pop();
          after.pop();
        }
        removed += before.length;
        added += after.length;
      } else if (typeof input.content === "string")
        added += input.content.split("\n").length;
    }
  }
  let remainingText = 256 * 1024;
  for (const ref of snapshot.messages) {
    const message = index(messages).byId.get(ref.messageId);
    if (message?.role !== "assistant" || !message.text.trim()) continue;
    const preview = content(message.text).slice(0, remainingText);
    remainingText -= preview.length;
    steps.push({
      stepId: `message:${message.id}`,
      seq: ref.seq,
      kind: "text",
      label: "",
      summary: content(message.text).slice(0, 512),
      content: preview || undefined,
      offsetMs: ref.offsetMs,
      durationMs: null,
      status: "ok",
      shape: "other",
      detailState:
        message.text.length > preview.length ? "truncated" : "available",
    });
  }
  steps.sort((a, b) => a.seq - b.seq || a.stepId.localeCompare(b.stepId));
  const model = lanes(spans, "model", messages),
    tool = lanes(spans, "tool", messages);
  const totalMs = summary.durationMs ?? summary.lastOffsetMs;
  const first = spans.find((s) => s.kind === "model");
  const triggerRef = snapshot.messages.find((m) => m.role === "user"),
    trigger = messages.find((m) => m.id === triggerRef?.messageId);
  return {
    summary,
    health,
    agentName: "AlphaCode",
    provider: first?.provider,
    modelId: first?.modelId,
    workspace,
    triggerSummary:
      trigger?.role === "user"
        ? content(trigger.content).slice(0, 512)
        : undefined,
    lanes:
      totalMs > 0
        ? {
            model,
            tool,
            totalMs,
            modelMs: model.reduce((a, b) => a + b.durationMs, 0),
            toolMs: tool.reduce((a, b) => a + b.durationMs, 0),
          }
        : null,
    steps,
    searchScope: "input_and_output_preview",
    outcome:
      files.size || commands
        ? { files: files.size, added, removed, commands }
        : undefined,
  };
}

/** Matches Multica's tool-name/input/first-4KB-output search, after redaction. */
export function searchTraceSteps(
  snapshot: TraceSnapshot,
  messages: readonly Message[],
  query: string,
): string[] {
  const needle = query.trim().toLowerCase();
  const view = buildTraceView(snapshot, messages, {
    persistence: "ready",
    droppedEvents: 0,
  });
  return view.steps
    .filter((step) => {
      const detail = buildTraceDetail(snapshot, messages, step.stepId);
      return `${step.label} ${JSON.stringify(detail?.input ?? {})} ${(detail?.output ?? "").slice(0, 4000)} ${detail?.content ?? step.summary}`
        .toLowerCase()
        .includes(needle);
    })
    .map((step) => step.stepId);
}
export function buildTraceDetail(
  snapshot: TraceSnapshot,
  messages: readonly Message[],
  stepId: string,
): TraceStepDetail | undefined {
  if (stepId.startsWith("message:")) {
    const id = stepId.slice(8);
    if (!snapshotIndex(snapshot).messages.has(id)) return;
    const message = index(messages).byId.get(id);
    return {
      stepId,
      state:
        message?.role === "assistant"
          ? message.text.length > textLimit
            ? "truncated"
            : "available"
          : "missing",
      content:
        message?.role === "assistant" ? content(message.text) : undefined,
    };
  }
  const span = snapshotIndex(snapshot).spans.get(stepId);
  if (!span) return;
  if (span.kind === "model")
    return {
      stepId,
      state: "available",
      input: { provider: span.provider, model: span.modelId },
      output: JSON.stringify(
        {
          status: span.status,
          inputTokens: span.inputTokens,
          outputTokens: span.outputTokens,
          firstTextMs: span.firstTextMs,
          errorCode: span.errorCode,
        },
        null,
        2,
      ),
    };
  const call = callFor(span, messages),
    rawOutput = toolOutput(span, messages),
    input = call ? normalizedInput(call.arguments) : undefined;
  return {
    stepId,
    state:
      call || rawOutput !== undefined
        ? JSON.stringify(call?.arguments ?? {}).length > textLimit ||
          (rawOutput?.length ?? 0) > textLimit
          ? "truncated"
          : "available"
        : "not_captured",
    input,
    output: rawOutput === undefined ? undefined : content(rawOutput),
  };
}
