/** Public contracts for the ADK microkernel. */
import type { LanguageModel, GenerateResult, Json as ProviderJson } from '@alpha/provider';
import type { StandardSchemaV1, StandardJSONSchemaV1 } from '@standard-schema/spec';

export type Awaitable<T> = T | Promise<T>;
export type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };
export type JsonObject = { readonly [k: string]: Json };
// 将递归 Provider JSON 固定映射为只读 JSON，避免类型无限展开。
export type DeepReadonly<T> = [T, ProviderJson] extends [ProviderJson, T]
  ? Json : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type Effect = 'read' | 'write' | 'unknown';
export type Usage = Readonly<NonNullable<GenerateResult['usage']>>;
export interface AdkError { code: string; message: string }

// 复用 Provider 的结果结构；只增加历史身份及只读语义。
// text / finishReason / refusal / incompleteReason / responseId / continuation 原样保留。
export type AssistantMessage = DeepReadonly<GenerateResult> & {
  readonly id: string;
  readonly role: 'assistant';
};
export type ToolExecution = 'succeeded' | 'failed' | 'denied' |
  'not_executed' | 'outcome_unknown';
export interface ToolResultMessage {
  readonly id: string;
  readonly role: 'toolResult';
  readonly assistantId: string; // 与 callId 一起构成配对键
  readonly callId: string;
  readonly content: string;
  readonly execution: ToolExecution;
}
export type Message =
  | { readonly id: string; readonly role: 'user'; readonly content: string }
  | AssistantMessage
  | ToolResultMessage
  | { readonly id: string; readonly role: 'custom';
      readonly kind: string; readonly data: Json };

export interface ToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly effect: Effect;
}
export interface RunContext<C> {
  readonly agentId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly app: C;
}
export interface ToolContext<C> extends RunContext<C> {
  readonly assistantId: string; readonly callId: string;
}
// 规范化工具供适配器作者使用；业务侧只写 createTool({ input, execute })。
export interface PreparedTool<C> {
  readonly arguments: JsonObject;
  readonly execute: (ctx: ToolContext<C>) => Awaitable<string>;
}
export interface Tool<C = unknown> {
  readonly info: ToolInfo;
  readonly prepare: (
    raw: JsonObject, signal: AbortSignal
  ) => Awaitable<PreparedTool<C>>;
}
// prepare 校验一次；execute 闭包绑定同一份冻结参数。
// prepare 不做业务副作用；网关保证同一已确认调用只执行一次。

// 模型能力直接使用 @alpha/provider 的 LanguageModel。
// 没有 ADK 专属的请求、结果、流事件协议或第二层模型适配接口。
export interface ValidatedCall {
  readonly assistantId: string; readonly callId: string;
  readonly name: string;
  readonly arguments: JsonObject;
  readonly effect: Effect;
}
export interface HookMap<C> {
  beforeModel: (messages: readonly Message[], ctx: RunContext<C>) =>
    Awaitable<readonly Message[]>;
  authorizeTool: (call: ValidatedCall, ctx: RunContext<C>) =>
    Awaitable<{ action: 'allow' } | { action: 'deny'; reason: string }>;
  mapToolResult: (result: Readonly<ToolResultMessage>, ctx: RunContext<C>) =>
    Awaitable<string>;
}
export type Hooks<C> = {
  readonly [K in keyof HookMap<C>]?: readonly HookMap<C>[K][];
};
export interface Limits {
  maxModelCalls: number;        // 默认 8
  maxToolCalls: number;         // 默认 32；同时限制单响应调用列表长度
  timeoutMs?: number;           // 缺省无墙钟期限；不代表强制终止
  maxModelOutputBytes: number;  // 默认 1 MiB
  maxToolResultBytes: number;   // 默认 128 KiB
  maxHistoryBytes: number;      // 默认 4 MiB
  maxHistoryMessages: number;   // 默认 512
}
export type RunStatus = 'completed' | 'refused' | 'incomplete' | 'unknown' |
  'limited' | 'cancelled' | 'failed';
export type RunResult = {
  readonly runId: string;
  readonly text: string; // 本 run 最后已提交的 assistant 内容，可能为空
  readonly usage?: Readonly<Usage>; // 仅汇总已报告量，不是完整费用账单
} & (
  | { readonly status: 'failed'; readonly error: AdkError }
  | { readonly status: Exclude<RunStatus, 'failed'>; readonly reason?: string }
);
export interface AgentState {
  readonly status: 'idle' | 'running' | 'cancelling' | 'closed';
  readonly historyStatus: 'ready' | 'blocked';
  /** Unexpected boundary failure quarantines future calls without rewriting the completed run. */
  readonly boundaryStatus: 'none' | 'ready' | 'failed';
  readonly messages: readonly Message[];
}
export interface PromptOptions {
  readonly signal?: AbortSignal;
  /** Omitted IDs identify new requests; retries must provide the same explicit ID. */
  readonly requestId?: string;
}
export interface RunRequest<C> {
  readonly agentId: string;
  readonly requestId: string;
  readonly input: string;
  readonly signal: AbortSignal;
  readonly app: C;
}
export interface RunSnapshot {
  readonly result: RunResult;
  readonly messages: readonly Message[];
  readonly historyStatus: 'ready' | 'blocked';
}
export interface RunHistory {
  /** Valid only during prepare. Validates and returns an immutable canonical history. */
  restore(messages: readonly Message[]): readonly Message[];
}
export type RunPlan =
  | { readonly type: 'replay'; readonly result: RunResult }
  | { readonly type: 'execute';
      /** undefined means the kernel could not produce a trustworthy finalized snapshot. */
      readonly complete: (snapshot: RunSnapshot | undefined) => Awaitable<void> };
export interface RunBoundary<C = undefined> {
  prepare(request: RunRequest<C>, history: RunHistory): Awaitable<RunPlan>;
}
export interface EventMeta {
  readonly agentId: string; readonly runId: string; readonly seq: number;
}
export type AgentEvent = EventMeta & (
  | { type: 'run.start' }
  | { type: 'run.stop_requested'; status: 'cancelled' | 'failed' | 'limited' }
  | { type: 'model.start'; modelCallId: string }
  | { type: 'model.delta'; modelCallId: string; text: string }
  | { type: 'model.end'; modelCallId: string;
      outcome: GenerateResult['outcome'] | 'failed' | 'cancelled' }
  | { type: 'tool.start'; assistantId: string; callId: string; name: string }
  | { type: 'tool.end'; assistantId: string; callId: string; execution: ToolExecution }
  | { type: 'message.commit'; messageId: string; role: Message['role'] }
  | { type: 'run.end'; status: RunStatus }
);
export type AppOption<C> = undefined extends C
  ? { appContext?: C } : { appContext: C };
export type AgentOptions<C = undefined> = AppOption<C> & {
  id?: string;
  instructions: string;
  model?: LanguageModel; // 直接传 provider.use(...)，或由插件贡献
  plugins?: readonly Plugin<NoInfer<C>>[];
  signal?: AbortSignal; // 只取消创建 / 插件启动，不绑定后续 run
  tools?: readonly Tool<NoInfer<C>>[];
  hooks?: Hooks<NoInfer<C>>;
  limits?: Partial<Limits>;
  onObserverError?: (error: AdkError) => void;
};
// Context is bound at creation; retain its parameter in the public Agent type.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface Agent<C = undefined> {
  readonly id: string;
  readonly state: AgentState;
  prompt(input: string, options?: PromptOptions): Promise<RunResult>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  abort(reason?: string): void;
  waitForIdle(): Promise<void>;
  replaceMessages(messages: readonly Message[]): void;
  close(): Promise<void>;
}
// 以下声明同属 @alpha/adk/core；没有另一套创建入口。
export type InputSchema = StandardSchemaV1 & StandardJSONSchemaV1;
export type Infer<S extends InputSchema> = DeepReadonly<StandardSchemaV1.InferOutput<S>>;


// 单 schema：类型推导、校验与 JSON Schema 描述由同一 input 提供。
// core 只使用标准结构协议，不引入 Zod 或其他 schema 库的运行时依赖。

export interface PluginAPI<C> {
  provideModel(model: LanguageModel): void;
  /** At most one owner of the awaited invocation boundary; no Loop replacement. */
  provideRunBoundary(boundary: RunBoundary<C>): void;
  addTool(tool: Tool<C>): void;
  hook<K extends keyof HookMap<C>>(name: K, fn: HookMap<C>[K]): void;
  observe(listener: (event: AgentEvent) => void): void;
}
export interface Plugin<C = undefined> {
  readonly id: string;
  readonly apiVersion: 1;
  readonly requires?: readonly string[];
  setup(api: PluginAPI<C>): void;
  start?(signal: AbortSignal): Promise<void>;
  dispose?(): Awaitable<void>;
}
// setup 仅声明贡献；注册 API 在 setup 返回后关闭。
// createAgent 收集贡献后要求恰好一个 model，拒绝重复工具和非法配置。
// 插件不接收 loop、callModel、callTool 或可写历史引用。
