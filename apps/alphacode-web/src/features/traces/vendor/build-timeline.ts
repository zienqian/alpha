/* Based on Multica 10f0ab332e57035feadae43cff2cd511f0d1d1f1.
 * Copyright 2025-2026 Index Labs (Hong Kong) Limited.
 * See public/third-party/multica/LICENSE and NOTICE. Adapted for Alpha; see SOURCE.json. */
export interface TimelineItem { seq: number; type: "tool_use" | "tool_result" | "thinking" | "text" | "error"; tool?: string; callId?: string; content?: string; input?: Record<string, unknown>; output?: string; output_truncated?: boolean; created_at?: string; }
