/** Frontmatter parsing, 200-line MEMORY.md index compaction, and dual lexical+CJK tokenization. */
import { memoryTypes, type MemoryOwner, type MemoryScope, type MemoryTopic, type MemoryTopicMeta, type MemoryType } from "./contracts";

export const defaultMaxIndexLines = 200;
export const defaultMaxIndexBytes = 12 * 1024;
const maxLinePointerChars = 160;

export function slugifyTopic(input: string): string {
  const ascii = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (ascii) return ascii;
  // Deterministic fallback for pure non-ASCII titles (e.g. Chinese titles).
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `topic-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function escapeFrontmatterValue(value: string): string {
  const singleLine = value.replace(/[\r\n]+/g, " ").trim();
  if (!singleLine) return '""';
  if (/[:#"'[\]{},&*!?|>%@`]|^\s|\s$/.test(singleLine)) {
    return JSON.stringify(singleLine);
  }
  return singleLine;
}

function unquoteFrontmatterValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return String(JSON.parse(trimmed)); } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

export function serializeTopicMarkdown(topic: {
  readonly name: string;
  readonly description: string;
  readonly type: MemoryType;
  readonly owner: MemoryOwner;
  readonly updatedAt: string;
  readonly proposedBy?: string;
  readonly body: string;
}): string {
  const lines = [
    "---",
    `name: ${escapeFrontmatterValue(topic.name)}`,
    `description: ${escapeFrontmatterValue(topic.description)}`,
    `type: ${topic.type}`,
    `owner: ${topic.owner}`,
    `updated_at: ${escapeFrontmatterValue(topic.updatedAt)}`,
  ];
  if (topic.proposedBy) {
    lines.push(`proposed_by: ${escapeFrontmatterValue(topic.proposedBy)}`);
  }
  lines.push("---", "", topic.body.trim(), "");
  return lines.join("\n");
}

export function parseTopicMarkdown(
  raw: string,
  fallback: { readonly scope: MemoryScope; readonly slug: string; readonly path: string; readonly updatedAt: string },
): MemoryTopic {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(normalized);
  const fields: Record<string, string> = {};
  let body = normalized.trim();
  if (match) {
    const header = match[1] ?? "";
    body = (match[2] ?? "").trim();
    for (const line of header.split("\n")) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = unquoteFrontmatterValue(line.slice(idx + 1));
      if (key) fields[key] = value;
    }
  }
  const parsedType = memoryTypes.includes(fields.type as MemoryType) ? (fields.type as MemoryType) : "project";
  const parsedOwner: MemoryOwner = fields.owner === "user" ? "user" : "agent";
  const name = fields.name || fallback.slug;
  const firstBodyLine = body.split("\n").find(line => line.trim() && !line.trim().startsWith("#"))?.trim() ?? name;
  const description = fields.description || firstBodyLine.slice(0, 140);
  const updatedAt = fields.updated_at || fallback.updatedAt;
  return {
    scope: fallback.scope,
    slug: fallback.slug,
    path: fallback.path,
    name,
    description,
    type: parsedType,
    owner: parsedOwner,
    updatedAt,
    ...(fields.proposed_by ? { proposedBy: fields.proposed_by } : {}),
    body,
  };
}

export function truncateIndexMarkdown(
  content: string,
  maxLines = defaultMaxIndexLines,
  maxBytes = defaultMaxIndexBytes,
): { readonly content: string; readonly truncated: boolean; readonly totalLines: number } {
  const normalized = content.replace(/\r\n/g, "\n");
  const allLines = normalized.split("\n");
  const encoder = new TextEncoder();
  const kept: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const line of allLines) {
    if (kept.length >= maxLines) {
      truncated = true;
      break;
    }
    const lineBytes = encoder.encode(kept.length ? `\n${line}` : line).length;
    if (bytes + lineBytes > maxBytes) {
      truncated = true;
      break;
    }
    kept.push(line);
    bytes += lineBytes;
  }
  return { content: kept.join("\n").trimEnd(), truncated, totalLines: allLines.length };
}

function clipPointer(text: string): string {
  const flat = text.replace(/[\r\n]+/g, " ").trim();
  return flat.length > maxLinePointerChars ? `${flat.slice(0, maxLinePointerChars - 1)}…` : flat;
}

const sectionOrder: readonly { readonly type: MemoryType; readonly heading: string }[] = [
  { type: "feedback", heading: "## Feedback & Constraints" },
  { type: "user", heading: "## User Profile & Preferences" },
  { type: "project", heading: "## Project Context & Decisions" },
  { type: "reference", heading: "## References" },
];

export function buildIndexMarkdown(
  scope: MemoryScope,
  topics: readonly MemoryTopicMeta[],
  rollouts: readonly { readonly path: string; readonly title: string }[] = [],
  options?: { readonly maxLines?: number; readonly maxBytes?: number },
): string {
  const scopeLabel = scope.type === "user" ? "User" : scope.type === "bot" ? `Bot (${scope.id})` : `Project (${scope.id})`;
  const lines: string[] = [
    `# Memory Index · ${scopeLabel}`,
    "",
    "<!-- Pointer index only (capped at 200 lines). Read linked files via memory_read for full details. -->",
  ];
  const sorted = [...topics].sort((a, b) => {
    if (a.owner !== b.owner) return a.owner === "user" ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  for (const section of sectionOrder) {
    const items = sorted.filter(item => item.type === section.type);
    if (!items.length) continue;
    lines.push("", section.heading);
    for (const item of items) {
      const lockMark = item.owner === "user" ? " [user]" : "";
      lines.push(`- [${clipPointer(item.name)}](${item.path})${lockMark} — ${clipPointer(item.description)}`);
    }
  }
  const recentRollouts = rollouts.slice(0, 12);
  if (recentRollouts.length) {
    lines.push("", "## Recent Rollout Summaries (On-Demand)");
    for (const r of recentRollouts) {
      lines.push(`- [${clipPointer(r.title)}](${r.path})`);
    }
  }
  const raw = `${lines.join("\n")}\n`;
  const { content } = truncateIndexMarkdown(raw, options?.maxLines ?? defaultMaxIndexLines, options?.maxBytes ?? defaultMaxIndexBytes);
  return `${content}\n`;
}

/** Split identifiers (camelCase, snake_case, kebab-case, paths) for FTS5 unicode61 indexing. */
export function tokenizeLexical(text: string): string {
  const expanded = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[/_.:-]+/g, " ");
  return `${text} ${expanded}`.replace(/\s+/g, " ").trim();
}

/** Generate overlapping CJK 2-grams so SQLite FTS5 retrieves Chinese phrases without external extensions. */
export function tokenizeCjkBigrams(text: string): string {
  const runs = text.match(/[\u3400-\u9fff\uf900-\ufaff]+/g);
  if (!runs) return "";
  const grams: string[] = [];
  for (const run of runs) {
    if (run.length === 1) {
      grams.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        grams.push(run.slice(i, i + 2));
      }
    }
  }
  return grams.join(" ");
}
