/** Deterministic secret/credential scrubbing and relative path sandboxing. */

export interface SanitizeResult {
  readonly text: string;
  readonly redactedCount: number;
}

const secretPatterns: readonly RegExp[] = [
  // OpenAI / Anthropic / Stripe-like API keys
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/g,
  // GitHub tokens
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // AWS access keys
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // Bearer tokens & JWTs
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Private key blocks
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  // Explicit env / config key assignments carrying non-trivial values
  /\b([A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY))\s*[:=]\s*(['"]?)([^\s'"`]{8,})\2/g,
];

export function sanitizeMemoryText(input: string): SanitizeResult {
  let redactedCount = 0;
  let text = input;
  for (let i = 0; i < secretPatterns.length; i++) {
    const pattern = secretPatterns[i];
    if (!pattern) continue;
    if (i === secretPatterns.length - 1) {
      text = text.replace(pattern, (_match, key: string, quote: string) => {
        redactedCount++;
        return `${key}=${quote}[REDACTED]${quote}`;
      });
    } else {
      text = text.replace(pattern, () => {
        redactedCount++;
        return "[REDACTED]";
      });
    }
  }
  return { text, redactedCount };
}

const allowedRelativePattern = /^(?:MEMORY\.md|(?:topics|rollouts|pending)\/[a-z0-9][a-z0-9._-]{0,120}\.md)$/;

export function assertSafeRelativeMemoryPath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/").trim();
  if (!normalized || normalized.includes("\0") || normalized.includes("..") || normalized.startsWith("/")) {
    throw Object.assign(new Error("MEMORY_PATH_INVALID"), { code: "MEMORY_PATH_INVALID" });
  }
  if (!allowedRelativePattern.test(normalized)) {
    throw Object.assign(new Error("MEMORY_PATH_INVALID"), { code: "MEMORY_PATH_INVALID" });
  }
  return normalized;
}

export function sanitizeScopeSegment(id: string): string {
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 160 || trimmed.includes("\0")) {
    throw Object.assign(new Error("MEMORY_SCOPE_INVALID"), { code: "MEMORY_SCOPE_INVALID" });
  }
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === ".." || safe.includes("..")) {
    throw Object.assign(new Error("MEMORY_SCOPE_INVALID"), { code: "MEMORY_SCOPE_INVALID" });
  }
  return safe;
}
