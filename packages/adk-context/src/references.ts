import type { Message } from '@alpha/adk/core';
import { contentHash, contextError, createContextReference, parseContextReference, readContextText } from '@alpha/adk-artifact';
import type { ArtifactStore, ContextReader, ContextScope } from '@alpha/adk-artifact';

/** References the canonical message, including execution status and tool-call identity. */
export async function referenceForMessage(scope: ContextScope, message: Message): Promise<string> {
  return createContextReference(scope, 'message', message.id, await contentHash(JSON.stringify(message)));
}
export function createContextReader(options: {
  scope: ContextScope;
  artifacts: ArtifactStore;
  /** Current canonical history, never the compacted model projection. */
  messages: () => readonly Message[] | Promise<readonly Message[]>;
}): ContextReader {
  const scope = Object.freeze({ ...options.scope });
  return async request => {
    request = { ...request };
    const ref = await parseContextReference(scope, request.reference);
    if (ref.kind === 'artifact') return options.artifacts.read(scope, request);
    const message = (await options.messages()).find(m => m.id === ref.id);
    if (!message) throw contextError('CONTEXT_NOT_FOUND');
    const content = JSON.stringify(message);
    if (await contentHash(content) !== ref.sha256) throw contextError('CONTEXT_CONTENT_MISMATCH');
    return readContextText(content, request);
  };
}
