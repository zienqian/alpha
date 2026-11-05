import { ProviderError } from './errors';
import { responseError } from './protocols/shared';

/** Parse SSE incrementally, including split UTF-8 characters and CRLF boundaries. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let data: string[] = [];
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try { chunk = await reader.read(); }
      catch { if (signal?.aborted) throw signal.reason; throw new ProviderError('REQUEST_FAILED', 'Provider stream failed.'); }
      if (signal?.aborted) throw signal.reason;
      try { buffer += decoder.decode(chunk.value, { stream: !chunk.done }); } catch { return responseError(); }
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        // A trailing CR may be the first half of CRLF in the next chunk.
        if (!chunk.done && match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (!line) {
          if (data.length) { yield data.join('\n'); data = []; }
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line === 'data') data.push('');
      }
      if (chunk.done) break;
    }
    // A partial event is a truncated stream, not a complete SSE message.
  } finally {
    signal?.removeEventListener('abort', abort);
    try { await reader.cancel(); } catch { /* cancellation is best effort */ }
    reader.releaseLock();
  }
}
