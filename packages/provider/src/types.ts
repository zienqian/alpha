/** JSON-compatible values used for tool input and provider-specific options. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type Message =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; continuation?: AnthropicContinuation }
  | { role: 'tool'; toolCallId: string; content: string };
/** Opaque protocol blocks needed to continue an Anthropic tool-use turn. */
export interface AnthropicContinuation { readonly protocol: 'anthropic-messages'; readonly content: readonly Json[] }
export interface ToolCall { id: string; name: string; arguments: JsonObject }
export interface ToolDefinition { name: string; description?: string; inputSchema: JsonObject }
export interface GenerateInput {
  messages: Message[];
  tools?: ToolDefinition[];
  maxOutputTokens?: number;
  /** Logical level mapped by model thinkingLevelMap, or sent unchanged if no map is configured. */
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  /** Request-specific headers override configured headers, ignoring case. */
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** Continue a stored Responses API response; send only new input messages. */
  previousResponseId?: string;
}
export interface GenerateResult {
  /** Normalized outcome; inspect before treating text or tool calls as complete. */
  outcome: 'completed' | 'tool_calls' | 'refused' | 'incomplete' | 'unknown';
  text: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  /** Model-provided refusal text, when available. Treat as untrusted content. */
  refusal?: string;
  /** Provider's incomplete reason, when present. */
  incompleteReason?: string;
  /** Responses API response ID, usable with previousResponseId when the response is stored. */
  responseId?: string;
  /** Preserve unchanged with the assistant message when continuing an Anthropic tool-use turn. */
  continuation?: AnthropicContinuation;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Text is provisional until finish; tool calls are emitted only after a safe terminal outcome. */
export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'finish'; result: GenerateResult };

/** Alpha's own contract. Creating a model never makes a network request. */
export interface LanguageModel {
  readonly provider: string;
  readonly modelId: string;
  /** Model capabilities and request compatibility settings. */
  readonly metadata?: ModelMetadata;
  generate(input: GenerateInput): Promise<GenerateResult>;
  stream(input: GenerateInput): AsyncIterable<StreamEvent>;
}
export type Credential = { readonly env: string } | { readonly none: true };
export type HeaderValue = string | { readonly env: string };
export interface CommonOptions {
  readonly apiKey: Credential;
  readonly baseURL?: string;
  readonly headers?: Readonly<Record<string, HeaderValue>>;
}
export interface AnthropicOptions extends CommonOptions { readonly apiKey: { readonly env: string }; readonly maxOutputTokens?: number }
export interface OpenAICompletionsOptions extends CommonOptions {
  readonly queryParams?: Readonly<Record<string, string>>;
  /** Select the output-token field expected by the endpoint. Defaults to max_tokens for compatibility. */
  readonly maxTokensField?: 'max_tokens' | 'max_completion_tokens';
}
export interface OpenAIResponsesOptions extends CommonOptions {
  readonly queryParams?: Readonly<Record<string, string>>;
}
/** A user-authorized OAuth access token; the application owns login and renewal. */
export interface OpenAICodexResponsesOptions {
  readonly accessToken: { readonly env: string };
  readonly baseURL?: string;
  readonly headers?: Readonly<Record<string, HeaderValue>>;
}
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export interface ModelMetadata {
  readonly name?: string;
  readonly reasoning?: boolean;
  readonly input?: readonly ('text' | 'image' | 'audio' | 'video')[];
  /** USD per million tokens, supplied by the user; no automatic cost calculation. */
  readonly cost?: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly thinkingLevelMap?: Readonly<Partial<Record<ThinkingLevel, string | null>>>;
  readonly compat?: { readonly supportsDeveloperRole?: boolean; readonly supportsReasoningEffort?: boolean };
}
export type ModelConfig = { readonly id: string } & ModelMetadata;
export type ProviderEntry = {
  readonly adapter: string;
  readonly options: Readonly<Record<string, Json>>;
  readonly models: Readonly<Record<string, ModelConfig>>;
};
export type ProviderConfig = { readonly providers: Readonly<Record<string, ProviderEntry>> };
type CheckedEntry<T extends ProviderEntry> = T & (
  T['adapter'] extends 'anthropic-messages' ? { readonly options: AnthropicOptions } :
  T['adapter'] extends 'openai-completions' ? { readonly options: OpenAICompletionsOptions } :
  T['adapter'] extends 'openai-responses' ? { readonly options: OpenAIResponsesOptions } :
  T['adapter'] extends 'openai-codex-responses' ? { readonly options: OpenAICodexResponsesOptions } : unknown
);
export type CheckedConfig<T extends ProviderConfig> = T & {
  readonly providers: { readonly [K in keyof T['providers']]: CheckedEntry<T['providers'][K]> };
};
export interface AdapterContext { getEnv(name: string): string | undefined; fetch: typeof fetch }
export interface ProviderAdapter {
  validate(options: Readonly<Record<string, Json>>): void;
  createModel(options: Readonly<Record<string, Json>>, modelId: string, context: AdapterContext): LanguageModel;
}
export interface CreateProviderOptions {
  readonly adapters?: Readonly<Record<string, ProviderAdapter>>;
  readonly getEnv?: (name: string) => string | undefined;
  readonly fetch?: typeof fetch;
}
export interface Provider<T extends ProviderConfig> {
  use<P extends keyof T['providers'] & string>(providerName: P, modelAlias: keyof T['providers'][P]['models'] & string): LanguageModel;
  list(): Array<{ name: string; adapter: string; models: Array<{ alias: string } & ModelConfig> }>;
}
