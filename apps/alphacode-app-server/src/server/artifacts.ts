import { basename, resolve } from 'node:path';
import type { ArtifactStore, ContextScope } from '@alpha/adk-artifact';
import type { Message } from '@alpha/adk/core';
import { documentResponse } from './document-response';
import { fail } from './security';
import { localPath } from './files';

export async function artifactDocument(store: ArtifactStore, scope: ContextScope, reference: string, url: URL) {
  let snapshot;
  try { snapshot = await store.get(scope, reference); }
  catch (error) {
    const code = (error as { code?: string }).code;
    return fail(code === 'CONTEXT_SCOPE_MISMATCH' ? 403 : code === 'CONTEXT_NOT_FOUND' ? 404 : 400, code ?? 'ARTIFACT_UNAVAILABLE');
  }
  const { artifact, content } = snapshot, source = artifact.source;
  const path = source?.channel === 'file' ? source.path : `${source?.channel ?? artifact.id}.txt`;
  return documentResponse({ path, name: basename(path), size: artifact.bytes, mediaType: artifact.mediaType,
    body: content, reference: artifact.reference, createdAt: artifact.createdAt }, url);
}

/** Resolve path links to the last snapshot known at this reply, not the current workspace file. */
export interface DocumentWrite { assistantId: string; callId: string; path: string }
export function documentWrites(messages: readonly Message[]): DocumentWrite[] {
  const assistants = new Map(messages.filter(message => message.role === 'assistant').map(message => [message.id, message]));
  return messages.flatMap(message => {
    if (message.role !== 'toolResult' || message.execution !== 'succeeded') return [];
    const call = assistants.get(message.assistantId)?.toolCalls.find(call => call.id === message.callId);
    if (!call || !['create_file', 'edit_file'].includes(call.name)) return [];
    try {
      const result = JSON.parse(message.content);
      if (result.ok === true && (result.data?.created === true || result.data?.changed === true) && typeof result.data.path === 'string') {
        return [{ assistantId: message.assistantId, callId: message.callId, path: result.data.path }];
      }
    } catch { /* Invalid results cannot establish a saved document version. */ }
    return [];
  });
}

export async function artifactForPath(store: ArtifactStore, scope: ContextScope, workspace: string, path: string, writes: readonly DocumentWrite[]) {
  const normalize = (value: string) => process.platform === 'win32' ? resolve(workspace, value).toLowerCase() : resolve(workspace, value);
  const target = normalize(localPath(path));
  const write = writes.findLast(write => normalize(write.path) === target);
  if (!write) return;
  // A newer applied write without a snapshot must fall back to the file, not an older artifact.
  return (await store.list(scope)).findLast(artifact => artifact.source?.channel === 'file'
    && artifact.source.assistantId === write.assistantId && artifact.source.callId === write.callId
    && normalize(artifact.source.path) === target)?.reference;
}
