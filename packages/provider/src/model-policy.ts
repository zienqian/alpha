import { ProviderError } from './errors';
import type { ProtocolName } from './stream-codecs';
import type { GenerateInput, ModelMetadata } from './types';

/** Apply explicit model limits and protocol options without guessing model capabilities. */
export function applyModelPolicy(body: Record<string, unknown>, input: GenerateInput, metadata: ModelMetadata, protocol: ProtocolName, defaultMaxOutputTokens?: number): void {
  const requestedMax = input.maxOutputTokens ?? defaultMaxOutputTokens;
  if (metadata.maxTokens !== undefined && requestedMax !== undefined && requestedMax > metadata.maxTokens) {
    throw new ProviderError('INVALID_INPUT', 'Requested maxOutputTokens exceeds the configured model maxTokens.');
  }
  if (input.messages.some((message) => message.role === 'developer') && (protocol === 'anthropic' || metadata.compat?.supportsDeveloperRole === false)) {
    throw new ProviderError('INVALID_INPUT', 'Developer messages are not supported by this model or protocol.');
  }
  const level = input.thinkingLevel;
  if (level === undefined) return;
  if (metadata.reasoning === false || metadata.compat?.supportsReasoningEffort === false) {
    throw new ProviderError('INVALID_INPUT', 'Thinking level is not supported by this model.');
  }
  const map = metadata.thinkingLevelMap;
  const mapped = map ? (Object.hasOwn(map, level) ? map[level] : undefined) : level;
  if (mapped == null) throw new ProviderError('INVALID_INPUT', 'Thinking level has no supported model mapping.');
  if (protocol === 'completions') body.reasoning_effort = mapped;
  else if (protocol === 'responses') body.reasoning = { effort: mapped };
  else {
    if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(mapped)) {
      throw new ProviderError('INVALID_INPUT', 'Thinking level mapping is not supported by the Anthropic protocol.');
    }
    body.output_config = { effort: mapped };
  }
}
