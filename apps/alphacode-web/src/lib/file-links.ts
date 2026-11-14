import { defaultUrlTransform } from "react-markdown";

export function isLocalFileLink(value: string) {
  if (!value || /^[#?]/.test(value) || /^[\\/]{2}/.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  return /^[a-z]:[\\/]/i.test(value) || /^file:/i.test(value) || !/^[a-z][a-z\d+.-]*:/i.test(value);
}

export function markdownURL(value: string, key: string) {
  return key === "href" && (isLocalFileLink(value) || isArtifactLink(value)) ? value : defaultUrlTransform(value);
}

export function isArtifactLink(value: string) {
  return value.length <= 4096 && /^context:\/\/[a-f0-9]{64}\/artifact\/[^/?#\s]+\?sha256=[a-f0-9]{64}(?:#[^\s]*)?$/.test(value);
}

export function sessionDocumentURL(sessionId: string, path: string, mode: "info" | "open" | "download" = "open", replyId?: string) {
  const artifact = isArtifactLink(path);
  const query = new URLSearchParams(artifact ? { reference: path.split('#')[0] ?? path, mode } : { path, mode });
  if (!artifact && replyId) query.set('replyId', replyId);
  return `/api/sessions/${encodeURIComponent(sessionId)}/${artifact ? 'artifacts' : 'files'}?${query}${mode === 'open' && path.includes('#') ? path.slice(path.indexOf('#')) : ''}`;
}
