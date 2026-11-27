import { extname } from "node:path";
import type { GenerateInput, LanguageModel, Message as ProviderMessage, StreamEvent, UserContentPart } from "@alpha/provider";
import { parseAttachmentInput } from "../input";
import { isLikelyUtf8Text, isVisionImage, type UploadStore } from "../uploads";

const maxInlineTextBytes = 32 * 1024;
const maxTotalInlineTextBytes = 64 * 1024;
const maxInlineImageBytes = 10 * 1024 * 1024;
const maxInlineImagesPerRequest = 6;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function codeFenceFor(content: string): string {
  let maxRun = 2;
  for (const match of content.matchAll(/`+/g)) {
    if (match[0].length > maxRun) maxRun = match[0].length;
  }
  return "`".repeat(maxRun + 1);
}

function fenceLang(name: string): string {
  const ext = extname(name).toLowerCase().slice(1);
  return /^[a-z0-9+-]{1,16}$/.test(ext) ? ext : "";
}

export interface HydrateAttachmentsOptions {
  readonly uploads?: UploadStore;
  readonly scopeId: string;
  readonly mode: "coding" | "router";
  readonly includeImages?: boolean;
  readonly imageFallbackNote?: boolean;
}

export async function hydrateModelInput(
  input: GenerateInput,
  options: HydrateAttachmentsOptions,
): Promise<{ input: GenerateInput; hasImages: boolean }> {
  const includeImages = options.includeImages ?? true;
  let remainingImages = includeImages ? maxInlineImagesPerRequest : 0;
  let hasImages = false;

  // Walk from newest to oldest so the most recent screenshots get priority within the image budget.
  const hydrated: ProviderMessage[] = new Array(input.messages.length);
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i];
    if (!message || message.role !== "user" || typeof message.content !== "string") {
      if (message) hydrated[i] = message;
      continue;
    }
    const envelope = parseAttachmentInput(message.content);
    if (!envelope) {
      hydrated[i] = message;
      continue;
    }

    const lines: string[] = [];
    if (envelope.text.trim()) {
      lines.push(envelope.text);
    }
    lines.push("[Attached Files]");
    const imageParts: UserContentPart[] = [];
    let inlineTextBudget = maxTotalInlineTextBytes;

    for (const item of envelope.attachments) {
      const stored = options.uploads ? await options.uploads.readBytes(options.scopeId, item.id) : undefined;
      if (!stored) {
        lines.push(`- ${item.name} (${item.mediaType}, ${formatBytes(item.size)}) — file unavailable on disk.`);
        continue;
      }
      const { upload, bytes } = stored;
      const vision = isVisionImage(upload.mediaType, bytes);
      if (vision && includeImages && remainingImages > 0 && bytes.byteLength <= maxInlineImageBytes) {
        remainingImages--;
        hasImages = true;
        imageParts.push({
          type: "image",
          mediaType: upload.mediaType,
          data: Buffer.from(bytes).toString("base64"),
        });
        lines.push(`- ${upload.name} (${upload.mediaType}, ${formatBytes(upload.size)}, local path: ${upload.path}) — image attached inline below.`);
        continue;
      }
      if (vision) {
        const reason = options.imageFallbackNote
          ? "model endpoint rejected image input; inspect via local path if needed"
          : bytes.byteLength > maxInlineImageBytes
            ? "image exceeds inline size limit; inspect via local path"
            : "image omitted due to per-request image limit; inspect via local path";
        lines.push(`- ${upload.name} (${upload.mediaType}, ${formatBytes(upload.size)}, local path: ${upload.path}) — ${reason}.`);
        continue;
      }

      if (bytes.byteLength <= maxInlineTextBytes && bytes.byteLength <= inlineTextBudget && isLikelyUtf8Text(bytes)) {
        inlineTextBudget -= bytes.byteLength;
        const textContent = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        const fence = codeFenceFor(textContent);
        const lang = fenceLang(upload.name);
        lines.push(`- ${upload.name} (${upload.mediaType}, ${formatBytes(upload.size)}, local path: ${upload.path}):`);
        lines.push(`${fence}${lang}`);
        lines.push(textContent);
        lines.push(fence);
        continue;
      }

      const inspectHint = options.mode === "router"
        ? "pass this local path to dispatch_task so a background Worker can inspect the file"
        : "use read_file (for text files) or run_command to inspect this file at the local path";
      lines.push(`- ${upload.name} (${upload.mediaType}, ${formatBytes(upload.size)}, local path: ${upload.path}) — ${inspectHint}.`);
    }

    const textBlock = lines.join("\n");
    if (imageParts.length > 0) {
      hydrated[i] = {
        role: "user",
        content: [{ type: "text", text: textBlock }, ...imageParts],
      };
    } else {
      hydrated[i] = {
        role: "user",
        content: textBlock,
      };
    }
  }

  return { input: { ...input, messages: hydrated }, hasImages };
}

function isVisionRejectedError(error: unknown): boolean {
  const err = error as { code?: string; status?: number } | undefined;
  return err?.code === "REQUEST_FAILED" && (err.status === 400 || err.status === 415 || err.status === 422);
}

export function wrapModelWithAttachments(
  model: LanguageModel,
  options: {
    readonly uploads?: UploadStore;
    readonly scopeId: string;
    readonly mode: "coding" | "router";
    readonly onStreamStart?: () => void;
  },
): LanguageModel {
  return {
    provider: model.provider,
    modelId: model.modelId,
    metadata: model.metadata,
    async generate(input) {
      const prepared = await hydrateModelInput(input, {
        uploads: options.uploads,
        scopeId: options.scopeId,
        mode: options.mode,
        includeImages: true,
      });
      try {
        return await model.generate(prepared.input);
      } catch (error) {
        if (!prepared.hasImages || !isVisionRejectedError(error)) throw error;
        const fallback = await hydrateModelInput(input, {
          uploads: options.uploads,
          scopeId: options.scopeId,
          mode: options.mode,
          includeImages: false,
          imageFallbackNote: true,
        });
        return model.generate(fallback.input);
      }
    },
    async *stream(input): AsyncIterable<StreamEvent> {
      options.onStreamStart?.();
      const prepared = await hydrateModelInput(input, {
        uploads: options.uploads,
        scopeId: options.scopeId,
        mode: options.mode,
        includeImages: true,
      });
      let emitted = false;
      try {
        for await (const event of model.stream(prepared.input)) {
          emitted = true;
          yield event;
        }
      } catch (error) {
        if (emitted || !prepared.hasImages || !isVisionRejectedError(error)) throw error;
        const fallback = await hydrateModelInput(input, {
          uploads: options.uploads,
          scopeId: options.scopeId,
          mode: options.mode,
          includeImages: false,
          imageFallbackNote: true,
        });
        for await (const event of model.stream(fallback.input)) {
          yield event;
        }
      }
    },
  };
}
