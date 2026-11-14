import { extname, resolve } from 'node:path';
import type { JsonObject, ToolContext } from '@alpha/adk/core';
import type { CodingContext, FileWrite } from './contracts';
import { codeOf } from './internal';

const documentTypes: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html', '.md': 'text/markdown', '.markdown': 'text/markdown',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.svg': 'image/svg+xml',
};

/** Capture the exact applied write, not a later filesystem read that could race another writer. */
export async function saveFileArtifact(ctx: ToolContext<CodingContext>, write: FileWrite, revision: string): Promise<JsonObject> {
  const options = ctx.app.artifacts, mediaType = documentTypes[extname(write.path).toLowerCase()];
  if (!options || !mediaType) return {};
  try {
    const saved = await options.store.put(options.scope, { content: write.content, mediaType, complete: true,
      source: { runId: ctx.runId, assistantId: ctx.assistantId, callId: ctx.callId, channel: 'file',
        path: resolve(ctx.app.cwd, write.path).replaceAll('\\', '/'), revision } });
    return { artifact: { reference: saved.reference, sha256: saved.sha256, bytes: saved.bytes, mediaType: saved.mediaType },
      artifactStorage: { status: 'saved' } };
  } catch (cause) {
    // The file write already succeeded. A failed snapshot must never authorize a replay.
    return { artifactStorage: { status: 'failed', code: codeOf(cause, 'ARTIFACT_SAVE_FAILED') } };
  }
}
