import { anthropicProtocol } from './protocols/anthropic.js';
import { completionsProtocol } from './protocols/completions.js';
import { responsesProtocol } from './protocols/responses.js';
import { responseError, responseFailed } from './protocols/shared.js';
import type { GenerateResult } from './types.js';

// Wire events are untrusted and differ per protocol; validate accessed fields below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
export type ProtocolName = 'completions' | 'responses' | 'anthropic';
export interface StreamCodec { push(data: string): { text?: string; result?: GenerateResult } }

function json(data: string): Obj {
  let value: unknown;
  try { value = JSON.parse(data); } catch { return responseError(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return responseError();
  return value as Obj;
}

function completions(): StreamCodec {
  let text = '', refusal = '', reason: string | null = null;
  let usage: unknown;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  return { push(data) {
    if (data === '[DONE]') {
      if (reason === null) return responseError();
      return { result: completionsProtocol.decode({ choices: [{ finish_reason: reason, message: { content: text, ...(refusal ? { refusal } : {}), tool_calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => ({ type: 'function', id: call.id, function: { name: call.name, arguments: call.arguments } })) } }], usage }) };
    }
    const event = json(data);
    if (event.error) return responseFailed();
    if (!Array.isArray(event.choices)) return responseError();
    if (event.usage) usage = event.usage;
    const choice = event.choices[0];
    if (!choice) return {};
    if (!choice.delta || typeof choice.delta !== 'object') return responseError();
    if (choice.finish_reason != null) { if (typeof choice.finish_reason !== 'string') return responseError(); reason = choice.finish_reason; }
    const delta = choice.delta;
    if (delta.content != null && typeof delta.content !== 'string') return responseError();
    if (delta.refusal != null && typeof delta.refusal !== 'string') return responseError();
    if (delta.refusal) refusal += delta.refusal;
    if (delta.tool_calls != null) {
      if (!Array.isArray(delta.tool_calls)) return responseError();
      for (const part of delta.tool_calls) {
        if (!Number.isInteger(part.index) || part.index < 0) return responseError();
        const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
        if (part.id != null) { if (typeof part.id !== 'string') return responseError(); call.id += part.id; }
        if (part.type != null && part.type !== 'function') return responseError();
        if (part.function?.name != null) { if (typeof part.function.name !== 'string') return responseError(); call.name += part.function.name; }
        if (part.function?.arguments != null) { if (typeof part.function.arguments !== 'string') return responseError(); call.arguments += part.function.arguments; }
        calls.set(part.index, call);
      }
    }
    if (delta.content) { text += delta.content; return { text: delta.content }; }
    return {};
  } };
}

function responses(): StreamCodec {
  return { push(data) {
    if (data === '[DONE]') return responseError();
    const event = json(data);
    if (event.type === 'error' || event.type === 'response.failed') return responseFailed();
    if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      if (!event.response || event.response.status !== (event.type === 'response.completed' ? 'completed' : 'incomplete')) return responseError();
      return { result: responsesProtocol.decode(event.response) };
    }
    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') return responseError();
      return { text: event.delta };
    }
    if (typeof event.type !== 'string') return responseError();
    return {};
  } };
}

function anthropic(): StreamCodec {
  const blocks = new Map<number, Obj>();
  const stopped = new Set<number>();
  let reason: string | null = null;
  let inputTokens: number | undefined, outputTokens: number | undefined;
  return { push(data) {
    const event = json(data);
    if (event.type === 'error') return responseFailed();
    if (event.type === 'message_start') { inputTokens = event.message?.usage?.input_tokens; outputTokens = event.message?.usage?.output_tokens; }
    else if (event.type === 'content_block_start') {
      if (!Number.isInteger(event.index) || !event.content_block || blocks.has(event.index)) return responseError();
      const block = event.content_block;
      if (block.type === 'text') { if (typeof block.text !== 'string') return responseError(); blocks.set(event.index, { type: 'text', text: block.text }); if (block.text) return { text: block.text }; }
      else if (block.type === 'tool_use') blocks.set(event.index, { type: 'tool_use', id: block.id, name: block.name, input: block.input, partial: '' });
      else blocks.set(event.index, { ...block });
    } else if (event.type === 'content_block_delta') {
      const block = blocks.get(event.index), delta = event.delta;
      if (!block || stopped.has(event.index) || !delta || typeof delta.type !== 'string') return responseError();
      if (delta.type === 'text_delta') { if (block.type !== 'text' || typeof delta.text !== 'string') return responseError(); block.text += delta.text; return { text: delta.text }; }
      if (delta.type === 'input_json_delta') { if (block.type !== 'tool_use' || typeof delta.partial_json !== 'string') return responseError(); block.partial += delta.partial_json; }
      if (delta.type === 'thinking_delta') { if (block.type !== 'thinking' || typeof delta.thinking !== 'string' || typeof block.thinking !== 'string') return responseError(); block.thinking += delta.thinking; }
      if (delta.type === 'signature_delta') { if (block.type !== 'thinking' || typeof delta.signature !== 'string') return responseError(); block.signature = (block.signature ?? '') + delta.signature; }
    } else if (event.type === 'content_block_stop') {
      if (!blocks.has(event.index) || stopped.has(event.index)) return responseError();
      stopped.add(event.index);
    } else if (event.type === 'message_delta') {
      if (event.delta?.stop_reason != null) { if (typeof event.delta.stop_reason !== 'string') return responseError(); reason = event.delta.stop_reason; }
      if (event.usage?.output_tokens != null) outputTokens = event.usage.output_tokens;
    } else if (event.type === 'message_stop') {
      if (reason === null) return responseError();
      if (stopped.size !== blocks.size) return responseError();
      const content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => {
        if (block.type !== 'tool_use') return block;
        const { partial, ...rest } = block;
        let input = block.input;
        if (partial && reason === 'tool_use') { try { input = JSON.parse(partial); } catch { return responseError(); } }
        return { ...rest, input };
      });
      return { result: anthropicProtocol.decode({ content, stop_reason: reason, usage: { input_tokens: inputTokens, output_tokens: outputTokens } }) };
    } else if (typeof event.type !== 'string') return responseError();
    return {};
  } };
}

export function createStreamCodec(name: ProtocolName): StreamCodec {
  if (name === 'completions') return completions();
  if (name === 'responses') return responses();
  return anthropic();
}
