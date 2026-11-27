import type { ChatAttachment } from "./chat/contracts";

export type ParsedInput = { kind: "prompt"; text: string }
  | { kind: "command"; name: string; arguments: string; displayText: string };

export function parseInput(input: string): ParsedInput {
  const start = input.trimStart();
  if (start.startsWith("//")) return { kind: "prompt", text: start.slice(1).trimEnd() };
  if (!start.startsWith("/")) return { kind: "prompt", text: input.trim() };
  const command = /^\/([^\s]+)(?:\s([\s\S]*))?$/.exec(start);
  return { kind: "command", name: command?.[1] ?? "", arguments: command?.[2] ?? "", displayText: input };
}

export const skillInputPrefix = "Alpha skill input v1. The selected instructions do not grant tool permissions.\n";
export const attachmentInputPrefix = "Alpha attachment input v1. User-attached files are listed below.\n";

export interface AttachmentEnvelope {
  readonly text: string;
  readonly attachments: readonly ChatAttachment[];
}

export function encodeAttachmentInput(text: string, attachments: readonly ChatAttachment[]): string {
  const serialized = attachments.map(item => ({
    id: item.id,
    name: item.name,
    mediaType: item.mediaType,
    size: item.size,
    ...(item.sha256 ? { sha256: item.sha256 } : {}),
  }));
  return attachmentInputPrefix + JSON.stringify({
    kind: "alpha.attachment-input",
    version: 1,
    text,
    attachments: serialized,
  });
}

export function parseAttachmentInput(input: string): AttachmentEnvelope | undefined {
  if (!input.startsWith(attachmentInputPrefix)) return undefined;
  try {
    const value = JSON.parse(input.slice(attachmentInputPrefix.length)) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    if (value.kind !== "alpha.attachment-input" || value.version !== 1 || typeof value.text !== "string") return undefined;
    if (Object.keys(value).sort().join(",") !== "attachments,kind,text,version") return undefined;
    if (!Array.isArray(value.attachments) || value.attachments.length === 0 || value.attachments.length > 10) return undefined;
    const attachments: ChatAttachment[] = [];
    for (const raw of value.attachments) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== "string" || !/^[a-f0-9-]{8,64}$/.test(item.id)) return undefined;
      if (typeof item.name !== "string" || !item.name || item.name.length > 255) return undefined;
      if (typeof item.mediaType !== "string" || !item.mediaType || item.mediaType.length > 256) return undefined;
      if (typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size < 0) return undefined;
      if (item.sha256 !== undefined && (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256))) return undefined;
      attachments.push({
        id: item.id,
        name: item.name,
        mediaType: item.mediaType,
        size: item.size,
        ...(typeof item.sha256 === "string" ? { sha256: item.sha256 } : {}),
      });
    }
    return { text: value.text, attachments };
  } catch {
    return undefined;
  }
}

export function skillInputDisplay(input: string): string {
  if (!input.startsWith(skillInputPrefix) || new TextEncoder().encode(input).length > 48 * 1024) return input;
  try {
    const value = JSON.parse(input.slice(skillInputPrefix.length));
    const skill = value?.skill;
    if (value?.kind !== "alpha.skill-input" || value.version !== 1 || typeof value.displayText !== "string"
      || typeof value.arguments !== "string" || !skill || typeof skill !== "object" || Array.isArray(skill)
      || !["name", "filePath", "baseDir", "revision", "content"].every(field => typeof skill[field] === "string")
      || Object.keys(value).sort().join(",") !== "arguments,displayText,kind,skill,version"
      || Object.keys(skill).sort().join(",") !== "baseDir,content,filePath,name,revision"
      || skill.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)
      || new TextEncoder().encode(value.arguments).length > 8192 || !/^[a-f0-9]{64}$/.test(skill.revision)) return input;
    const parsed = parseInput(value.displayText);
    if (parsed.kind !== "command" || parsed.name !== skill.name || parsed.arguments !== value.arguments) return input;
    return value.displayText;
  } catch { return input; }
}

export function decodeUserInput(input: string, urlForAttachment?: (id: string) => string): { text: string; attachments?: ChatAttachment[] } {
  const envelope = parseAttachmentInput(input);
  if (!envelope) return { text: skillInputDisplay(input) };
  return {
    text: skillInputDisplay(envelope.text),
    attachments: envelope.attachments.map(item => ({
      ...item,
      ...(urlForAttachment ? { url: urlForAttachment(item.id) } : {}),
    })),
  };
}

export function publicAttachments(attachments: readonly ChatAttachment[] | undefined, urlForAttachment?: (id: string) => string): ChatAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map(({ id, name, mediaType, size, sha256, url }) => ({
    id,
    name,
    mediaType,
    size,
    ...(sha256 ? { sha256 } : {}),
    ...(url ?? (urlForAttachment ? urlForAttachment(id) : undefined) ? { url: url ?? urlForAttachment?.(id) } : {}),
  }));
}
