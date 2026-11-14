import type { Message, ModelToolInputReference } from '@alpha/adk/core';
import type { ArtifactStore, ContextScope } from '@alpha/adk-artifact';
import { referenceForMessage } from '@alpha/adk-context';

/** Projection is derived from successfully stored snapshots and canonical outcomes, never from model text. */
export function fileInputReferences(store: ArtifactStore, scope: ContextScope) {
  return async (history: readonly Message[], signal: AbortSignal): Promise<readonly ModelToolInputReference[]> => {
    const references: ModelToolInputReference[] = [];
    const messages = new Map(history.map(message => [message.id, message]));
    let artifacts;
    try { artifacts = await store.list(scope); } catch { return references; }
    const seen = new Set<string>();
    for (const artifact of artifacts) {
      signal.throwIfAborted();
      const source = artifact.source;
      if (source?.channel !== 'file' || !artifact.complete) continue;
      const assistant = messages.get(source.assistantId);
      if (assistant?.role !== 'assistant' || assistant.continuation) continue;
      const call = assistant.toolCalls.find(call => call.id === source.callId);
      if (!call || !['create_file', 'edit_file'].includes(call.name)) continue;
      const result = history.find(message => message.role === 'toolResult' && message.assistantId === assistant.id && message.callId === call.id);
      if (result?.role !== 'toolResult' || result.execution !== 'succeeded') continue;
      try {
        const value = JSON.parse(result.content);
        if (value.ok !== true || value.data?.artifact?.reference !== artifact.reference || value.data?.afterRevision !== source.revision) continue;
        // Missing/corrupt evidence keeps the original input available. No tool is replayed.
        const snapshot = await store.get(scope, artifact.reference);
        if (call.name === 'create_file' && call.arguments.content !== snapshot.content) continue;
        const reference = call.name === 'create_file' ? artifact.reference : await referenceForMessage(scope, assistant);
        for (const field of call.name === 'create_file' ? ['content'] : ['oldText', 'newText']) {
          const content = call.arguments[field], key = JSON.stringify([assistant.id, call.id, field]);
          if (typeof content !== 'string' || (call.name === 'edit_file' && content.length < 1024) || seen.has(key)) continue;
          seen.add(key); references.push({ assistantId: assistant.id, callId: call.id, field, reference });
        }
      } catch { /* Retain canonical input when a snapshot cannot be verified. */ }
    }
    signal.throwIfAborted();
    return references;
  };
}
