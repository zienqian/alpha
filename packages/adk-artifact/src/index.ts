export type ContextScope = { readonly namespace: string; readonly sessionId: string };
export type ContextReadRequest = { readonly reference: string; readonly offset?: number; readonly maxBytes?: number };
export type ContextReadResult = {
  readonly reference: string; readonly content: string; readonly offset: number; readonly nextOffset: number;
  readonly totalBytes: number; readonly hasMore: boolean; readonly complete: boolean;
};
export type ContextReader = (request: ContextReadRequest) => Promise<ContextReadResult>;
export type ArtifactInput = {
  readonly content: string;
  readonly mediaType?: string;
  /** False when capture stopped early, including cancellation or a capture limit. */
  readonly complete?: boolean;
  readonly source?: { readonly runId: string; readonly assistantId: string; readonly callId: string; readonly channel: 'stdout' | 'stderr' };
};
export type Artifact = {
  readonly id: string; readonly reference: string; readonly sha256: string; readonly bytes: number;
  readonly mediaType: string; readonly complete: boolean; readonly createdAt: string;
  readonly source?: ArtifactInput['source'];
};
export interface ArtifactStore {
  put(scope: ContextScope, input: ArtifactInput): Promise<Artifact>;
  read(scope: ContextScope, request: ContextReadRequest): Promise<ContextReadResult>;
  list(scope: ContextScope): Promise<readonly Artifact[]>;
  /** Tombstones the scope, rejecting subsequent writes from stale owners. */
  remove(scope: ContextScope): Promise<void>;
}
export const maxArtifactBytes = 8 * 1024 * 1024;
export const maxSessionArtifactBytes = 128 * 1024 * 1024;
export const maxContextReadBytes = 4096;
export const contextError = (code: string): Error & { code: string } => Object.assign(new Error(code), { code });
const encoder = new TextEncoder();
export async function contentHash(content: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(content))), b => b.toString(16).padStart(2, '0')).join('');
}
function scopeKey(scope: ContextScope): string {
  if (typeof scope.namespace !== 'string' || !scope.namespace || scope.namespace.length > 1024 ||
    typeof scope.sessionId !== 'string' || !scope.sessionId || scope.sessionId.length > 1024) throw contextError('CONTEXT_SCOPE_INVALID');
  return JSON.stringify([scope.namespace, scope.sessionId]);
}
/** Opaque, session-scoped identity plus the digest of the exact UTF-8 content. Never a filesystem path. */
export async function createContextReference(scope: ContextScope, kind: 'artifact' | 'message', id: string, sha256: string): Promise<string> {
  if (typeof id !== 'string' || !id || id.length > 1024 || !id.isWellFormed() ||
    !['artifact', 'message'].includes(kind) || !/^[a-f0-9]{64}$/.test(sha256)) throw contextError('CONTEXT_REFERENCE_INVALID');
  return `context://${await contentHash(scopeKey(scope))}/${kind}/${encodeURIComponent(id)}?sha256=${sha256}`;
}
export async function parseContextReference(scope: ContextScope, reference: string): Promise<{ kind: 'artifact' | 'message'; id: string; sha256: string }> {
  if (typeof reference !== 'string' || reference.length > 4096) throw contextError('CONTEXT_REFERENCE_INVALID');
  const match = /^context:\/\/([a-f0-9]{64})\/(artifact|message)\/([^/?#]+)\?sha256=([a-f0-9]{64})$/.exec(reference);
  if (!match) throw contextError('CONTEXT_REFERENCE_INVALID');
  if (match[1] !== await contentHash(scopeKey(scope))) throw contextError('CONTEXT_SCOPE_MISMATCH');
  let id: string;
  try { id = decodeURIComponent(match[3]); } catch { throw contextError('CONTEXT_REFERENCE_INVALID'); }
  if (!id || id.length > 1024) throw contextError('CONTEXT_REFERENCE_INVALID');
  return { kind: match[2] as 'artifact' | 'message', id, sha256: match[4] };
}
/** Byte offsets must be UTF-8 boundaries; nextOffset always is. Small pages also bound JSON escaping. */
export function readContextText(content: string, request: ContextReadRequest, complete = true): ContextReadResult {
  const bytes = encoder.encode(content), offset = request.offset ?? 0, maxBytes = request.maxBytes ?? maxContextReadBytes;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length ||
    !Number.isSafeInteger(maxBytes) || maxBytes < 4 || maxBytes > maxContextReadBytes ||
    (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80)) throw contextError('CONTEXT_RANGE_INVALID');
  let end = Math.min(bytes.length, offset + maxBytes);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  return { reference: request.reference, content: new TextDecoder().decode(bytes.subarray(offset, end)), offset,
    nextOffset: end, totalBytes: bytes.length, hasMore: end < bytes.length, complete };
}
export async function prepareArtifact(scope: ContextScope, input: ArtifactInput): Promise<Artifact> {
  if (typeof input.content !== 'string' || !input.content.isWellFormed()) throw contextError('ARTIFACT_INVALID');
  const bytes = encoder.encode(input.content).length;
  if (bytes > maxArtifactBytes) throw contextError('ARTIFACT_TOO_LARGE');
  const mediaType = input.mediaType ?? 'text/plain; charset=utf-8';
  if (typeof mediaType !== 'string' || mediaType.length > 256 || (input.complete !== undefined && typeof input.complete !== 'boolean') ||
    (input.source && (typeof input.source.runId !== 'string' || input.source.runId.length > 1024 ||
      typeof input.source.assistantId !== 'string' || input.source.assistantId.length > 1024 ||
      typeof input.source.callId !== 'string' || input.source.callId.length > 1024 || !['stdout', 'stderr'].includes(input.source.channel)))) throw contextError('ARTIFACT_INVALID');
  const id = crypto.randomUUID(), sha256 = await contentHash(input.content);
  return { id, reference: await createContextReference(scope, 'artifact', id, sha256), sha256, bytes, mediaType,
    complete: input.complete ?? true, createdAt: new Date().toISOString(), ...(input.source ? { source: { ...input.source } } : {}) };
}
export function createMemoryArtifactStore(): ArtifactStore {
  const scopes = new Map<string, Map<string, { metadata: Artifact; content: string }>>(), deleted = new Set<string>();
  return {
    async put(scope, input) {
      scope = { ...scope }; input = { ...input, ...(input.source ? { source: { ...input.source } } : {}) };
      const key = scopeKey(scope), metadata = await prepareArtifact(scope, input);
      if (deleted.has(key)) throw contextError('ARTIFACT_SCOPE_DELETED');
      const entries = scopes.get(key) ?? new Map<string, { metadata: Artifact; content: string }>();
      if ([...entries.values()].reduce((n, e) => n + e.metadata.bytes, 0) + metadata.bytes > maxSessionArtifactBytes || entries.size >= 10000) throw contextError('ARTIFACT_STORAGE_LIMIT');
      entries.set(metadata.id, { metadata, content: input.content }); scopes.set(key, entries);
      return structuredClone(metadata);
    },
    async read(scope, request) {
      scope = { ...scope }; request = { ...request };
      const ref = await parseContextReference(scope, request.reference);
      if (ref.kind !== 'artifact') throw contextError('CONTEXT_REFERENCE_INVALID');
      const entry = scopes.get(scopeKey(scope))?.get(ref.id);
      if (!entry) throw contextError('CONTEXT_NOT_FOUND');
      if (entry.metadata.sha256 !== ref.sha256) throw contextError('CONTEXT_CONTENT_MISMATCH');
      return readContextText(entry.content, request, entry.metadata.complete);
    },
    async list(scope) { return structuredClone([...(scopes.get(scopeKey(scope))?.values() ?? [])].map(e => e.metadata)); },
    async remove(scope) { const key = scopeKey(scope); deleted.add(key); scopes.delete(key); },
  };
}
