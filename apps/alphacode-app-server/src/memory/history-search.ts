/** Scoped session archive history searcher powering the memory_history_search tool. */
import type { SessionStore, SessionSummary } from "@alpha/adk-session";
import {
  sanitizeMemoryText,
  tokenizeCjkBigrams,
  type MemoryHistoryHit,
  type MemoryHistorySearcher,
} from "@alpha/adk-memory";
import { archiveSearchMessages } from "../server/search";

export interface SessionHistorySearcherOptions {
  readonly store: SessionStore;
  readonly namespaces: readonly string[];
  readonly excludeSessionId?: string;
  readonly maxSessionsPerNamespace?: number;
}

const defaultMaxSessionsPerNamespace = 60;
const maxHitsPerSession = 2;
const maxSnippetChars = 360;

interface ScoredHit {
  readonly hit: MemoryHistoryHit;
  readonly score: number;
}

function scoreMatch(textLower: string, phrase: string, terms: readonly string[], cjkBigrams: readonly string[]): { readonly score: number; readonly index: number } | undefined {
  if (!textLower) return undefined;
  const exactIndex = textLower.indexOf(phrase);
  if (exactIndex >= 0) {
    return { score: 12 + Math.min(phrase.length, 40) * 0.1, index: exactIndex };
  }
  if (terms.length > 1) {
    let matched = 0;
    let firstIndex = -1;
    for (const term of terms) {
      const idx = textLower.indexOf(term);
      if (idx >= 0) {
        matched++;
        if (firstIndex < 0 || idx < firstIndex) firstIndex = idx;
      }
    }
    if (matched === terms.length) {
      return { score: 7 + matched, index: firstIndex };
    }
    const minNeeded = Math.max(2, Math.ceil(terms.length * 0.6));
    if (matched >= minNeeded) {
      return { score: matched * 2, index: firstIndex };
    }
  }
  if (cjkBigrams.length >= 2) {
    let matched = 0;
    let firstIndex = -1;
    for (const gram of cjkBigrams) {
      const idx = textLower.indexOf(gram);
      if (idx >= 0) {
        matched++;
        if (firstIndex < 0 || idx < firstIndex) firstIndex = idx;
      }
    }
    const minNeeded = Math.max(2, Math.ceil(cjkBigrams.length * 0.65));
    if (matched >= minNeeded) {
      return { score: 3 + (matched / cjkBigrams.length) * 4, index: firstIndex };
    }
  }
  return undefined;
}

function buildSnippet(raw: string, matchIndex: number): string {
  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(raw.length, Math.max(start + 260, matchIndex + 160));
  const sliced = `${start > 0 ? "…" : ""}${raw.slice(start, end)}${end < raw.length ? "…" : ""}`;
  const clean = sanitizeMemoryText(sliced).text.trim();
  return clean.length > maxSnippetChars ? `${clean.slice(0, maxSnippetChars - 1)}…` : clean;
}

async function listNamespaceSessions(
  store: SessionStore,
  namespace: string,
  maxSessions: number,
  signal: AbortSignal,
): Promise<SessionSummary[]> {
  const results: SessionSummary[] = [];
  let cursor: string | undefined;
  while (results.length < maxSessions) {
    signal.throwIfAborted();
    const page = await store.list(namespace, { limit: Math.min(50, maxSessions - results.length), cursor });
    results.push(...page.items);
    if (!page.cursor || page.items.length === 0) break;
    cursor = page.cursor;
  }
  return results.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function createSessionHistorySearcher(options: SessionHistorySearcherOptions): MemoryHistorySearcher {
  const namespaces = [...new Set(options.namespaces.map(ns => ns.trim()).filter(Boolean))];
  const maxSessions = options.maxSessionsPerNamespace ?? defaultMaxSessionsPerNamespace;

  return async (query, { limit, signal }) => {
    const phrase = query.trim().toLowerCase();
    if (!phrase || namespaces.length === 0 || limit <= 0) return [];
    const terms = [...new Set(phrase.split(/\s+/).filter(Boolean))];
    const cjkBigrams = [...new Set(tokenizeCjkBigrams(phrase))];
    const scored: ScoredHit[] = [];

    for (const namespace of namespaces) {
      signal.throwIfAborted();
      let summaries: SessionSummary[];
      try {
        summaries = await listNamespaceSessions(options.store, namespace, maxSessions, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        continue;
      }

      for (const summary of summaries) {
        signal.throwIfAborted();
        if (options.excludeSessionId && summary.id === options.excludeSessionId) continue;
        const saved = await options.store.read({ namespace, id: summary.id }).catch(() => undefined);
        if (!saved) continue;

        const cleanTitle = sanitizeMemoryText(saved.data.title || summary.title || "").text.trim().slice(0, 120);
        const messages = archiveSearchMessages(saved.data);
        const sessionHits: ScoredHit[] = [];

        for (const msg of messages) {
          const text = [
            msg.text,
            msg.tool?.description,
            msg.tool?.command,
            msg.tool?.path,
            msg.tool?.output,
            msg.tool?.error,
          ].filter(Boolean).join("\n").replace(/\s+/g, " ").trim();
          if (!text) continue;
          const matched = scoreMatch(text.toLowerCase(), phrase, terms, cjkBigrams);
          if (!matched) continue;
          const role: MemoryHistoryHit["role"] = msg.role === "user" || msg.role === "assistant" || msg.role === "tool"
            ? msg.role
            : "assistant";
          const roleBoost = role === "user" ? 1.5 : role === "assistant" ? 1.0 : 0.2;
          sessionHits.push({
            score: matched.score + roleBoost,
            hit: {
              sessionId: summary.id,
              title: cleanTitle,
              role,
              messageId: msg.id,
              snippet: buildSnippet(text, matched.index),
              updatedAt: saved.data.updatedAt || summary.updatedAt,
            },
          });
        }

        if (sessionHits.length === 0 && cleanTitle) {
          const titleMatch = scoreMatch(cleanTitle.toLowerCase(), phrase, terms, cjkBigrams);
          if (titleMatch) {
            sessionHits.push({
              score: titleMatch.score,
              hit: {
                sessionId: summary.id,
                title: cleanTitle,
                role: "user",
                snippet: cleanTitle,
                updatedAt: saved.data.updatedAt || summary.updatedAt,
              },
            });
          }
        }

        sessionHits.sort((left, right) => right.score - left.score);
        scored.push(...sessionHits.slice(0, maxHitsPerSession));
      }
    }

    return scored
      .sort((left, right) => (right.score - left.score) || right.hit.updatedAt.localeCompare(left.hit.updatedAt))
      .slice(0, limit)
      .map(item => item.hit);
  };
}
