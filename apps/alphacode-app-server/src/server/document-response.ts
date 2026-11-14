import { extname } from 'node:path';
import { fail } from './security';

const contentPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const textExtensions = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.yaml', '.yml', '.toml', '.xml', '.js', '.jsx', '.ts', '.tsx', '.css', '.py', '.rs', '.go', '.sh']);
const images: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
export function fileMediaType(path: string) {
  const extension = extname(path).toLowerCase();
  return ['.html', '.htm'].includes(extension) ? 'text/html' : images[extension] ?? (textExtensions.has(extension) ? 'text/plain' : 'application/octet-stream');
}

export async function documentResponse(document: { path: string; name: string; size: number; mediaType: string; body: Blob | string; reference?: string; createdAt?: string }, url: URL) {
  const mode = url.searchParams.get('mode') ?? 'info';
  if (!['info', 'open', 'download'].includes(mode)) return fail(400, 'INVALID_FILE_MODE');
  const mediaType = document.mediaType.split(';')[0]?.trim();
  const kind = mediaType === 'text/html' ? 'html' : Object.values(images).includes(mediaType ?? '') ? 'image'
    : ['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(mediaType ?? '') ? 'text' : 'download';
  const { path, name, size, reference, createdAt } = document;
  if (mode === 'info') return Response.json({ path, name, size, mediaType, reference, createdAt });
  const headers = new Headers({ 'Content-Security-Policy': `sandbox allow-scripts; ${contentPolicy}; frame-ancestors 'none'`, 'X-Content-Type-Options': 'nosniff' });
  if (mode === 'download' || kind === 'download') {
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}`);
    return new Response(document.body, { headers });
  }
  headers.set('Content-Type', kind === 'html' ? 'text/html; charset=utf-8' : kind === 'image' ? mediaType ?? 'application/octet-stream' : 'text/plain; charset=utf-8');
  return new Response(document.body, { headers });
}
