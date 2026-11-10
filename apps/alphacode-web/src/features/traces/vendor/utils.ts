/* Based on Multica 10f0ab332e57035feadae43cff2cd511f0d1d1f1.
 * Copyright 2025-2026 Index Labs (Hong Kong) Limited.
 * See public/third-party/multica/LICENSE and NOTICE. Adapted for Alpha; see SOURCE.json. */
export function truncateWithEllipsis(text: string, maxLength: number): string { if(text.length<=maxLength)return text;if(maxLength<=1)return maxLength<=0?"":"…";const chars=Array.from(text);return chars.length<=maxLength?text:chars.slice(0,maxLength-1).join("").trimEnd()+"…"; }
