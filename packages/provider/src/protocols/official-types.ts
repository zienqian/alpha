import type { JsonObject } from '../types';

// Request fields implemented here, based on the vendors' official API
// references. These are subsets, not complete official SDK types.
// https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
// https://developers.openai.com/api/reference/resources/responses/methods/create
// https://platform.claude.com/docs/en/api/messages/create
export type OpenAIChatMessage =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };
export type OpenAIResponseInput =
  | { role: 'system' | 'developer' | 'user' | 'assistant'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string };
export type AnthropicMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: JsonObject }
  | { type: 'tool_result'; tool_use_id: string; content: string };
export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters: JsonObject } }>;
}

export interface OpenAIResponseRequest {
  model: string;
  input: OpenAIResponseInput[];
  max_output_tokens?: number;
  previous_response_id?: string;
  temperature?: number;
  tools?: Array<{ type: 'function'; name: string; description?: string; parameters: JsonObject }>;
}

export interface AnthropicMessageRequest {
  model: string;
  messages: Array<{ role: 'user' | 'assistant'; content: AnthropicMessageBlock[] }>;
  max_tokens: number;
  system?: string;
  temperature?: number;
  tools?: Array<{ name: string; description?: string; input_schema: JsonObject }>;
}
