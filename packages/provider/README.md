# @alpha/provider

Alpha 自己的 Provider 配置、模型接口和 HTTP 协议适配实现。运行时不依赖 AI SDK 或其他第三方库；Node.js 使用内置 `fetch`。

```ts
import { createProvider, defineProviderConfig } from '@alpha/provider';

const config = defineProviderConfig({
  providers: {
    deepseek: {
      adapter: 'openai-completions',
      options: {
        baseURL: 'https://your-service.example/v1',
        apiKey: { env: 'DEEPSEEK_API_KEY' },
      },
      models: {
        chat: { id: 'your-chat-model-id' },
        reasoning: { id: 'your-reasoning-model-id' },
      },
    },
  },
});

const provider = createProvider(config);
const model = provider.use('deepseek', 'chat');
const result = await model.generate({
  messages: [{ role: 'user', content: '你好' }],
  maxOutputTokens: 256,
});
if (result.outcome === 'completed') console.log(result.text);
```

`createProvider` 验证配置并保存快照；`use` 根据 Provider 和模型别名同步创建模型，不访问网络。每次调用 `use` 重新读取环境变量，已创建的模型保留当时的密钥。`provider.list()` 返回 Provider、适配器及模型配置元数据，不返回连接参数或密钥。静态配置可获得名称补全。

### 模型元数据

每个 `models` 条目可选填描述信息；连接、协议、地址属于 Provider，模型不需要重复声明。

```ts
models: {
  reasoning: {
    id: 'gpt-oss:20b',
    name: 'GPT-OSS 20B (Ollama)',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 32000,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: null },
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  },
}
```

使用 `provider.use('ollama', 'reasoning').metadata` 或 `provider.list()` 读取配置快照（`ollama` 为示例 Provider 名称）。`metadata` 在未配置额外字段时为 `undefined`，嵌套值只读。价格固定约定为每百万 token 的美元价格，全部由配置者提供；未知价格请省略 `cost`，不要用 0 表示未知。

其中 `maxTokens`、`thinkingLevelMap`、`reasoning` 和 `compat` 会影响内置适配器的请求校验或转换。其他字段仍用于描述；例如 `input: ['image']` 不代表当前已实现图像输入，`cost` 也不会自动计算费用。配置值应以目标服务的实际能力为准。

### 模型限制与思考等级

```ts
const result = await model.generate({
  messages: [{ role: 'user', content: '分析这个问题' }],
  maxOutputTokens: 2048,
  thinkingLevel: 'high',
});
```

- `maxTokens` 是配置的输出 token 上限，不是默认值；单次 `maxOutputTokens`（以及 Anthropic 的 Provider 默认值）超过它时请求前报 `INVALID_INPUT`。不估算输入 token，也不检查 `contextWindow`。
- 只有显式传入 `thinkingLevel` 才发送思考强度：Completions 使用 `reasoning_effort`，Responses 使用 `reasoning.effort`，Anthropic 使用 `output_config.effort`。`stream()` 采用相同规则。
- 未配置 `thinkingLevelMap` 时直接发送逻辑等级；配置映射后，只接受有非空字符串映射的等级，缺失或 `null` 表示不支持并报错。Anthropic 映射值限制为 `low`、`medium`、`high`、`xhigh` 或 `max`；OpenAI 兼容端点可配置其他字符串。
- `reasoning: false` 或 `compat.supportsReasoningEffort: false` 时，传入 `thinkingLevel` 会报错；省略配置不代表已经验证支持。`compat.supportsDeveloperRole: false` 时拒绝 `developer` 消息；Anthropic 协议始终不支持该角色，不会自动降级为 `system`。
- 这些规则只由内置适配器实现；自定义 adapter 负责自己的语义。模型实际支持的等级、角色和参数仍需按目标服务验证。

## 内置适配器

- `openai-completions`：使用 Chat Completions 协议，请求 `/chat/completions`，适用于 OpenAI 及兼容端点。
- `openai-responses`：使用 Responses 协议，请求 `/responses`，适用于支持该协议的服务。
- `anthropic-messages`：使用 Messages API；需要在 Provider 配置或每次 `generate` 中指定 `maxOutputTokens`。
- `openai-codex-responses`：使用应用通过官方 Sign in with ChatGPT 流程获得的 OAuth access token，调用公开 Responses API；由应用负责获取和刷新 token。

前三种适配器使用 `apiKey: { env: 'ENV_NAME' }` 或 `apiKey: { value: '实际密钥' }`；`openai-codex-responses` 使用相同形式的 `accessToken`，不接受无认证。凭证对象只能有一个字段；`value` 直接注入且不读取环境变量，适用于由宿主读取的用户配置文件。密钥不出现在 `list()` 或错误诊断中；宿主负责配置文件权限。内置适配器的 `headers` 支持静态字符串或环境变量引用；`openai-completions` 和 `openai-responses` 额外支持 `queryParams`，无认证端点可使用 `apiKey: { none: true }`。三个 OpenAI 适配器的 `baseURL` 默认为 `https://api.openai.com/v1`，接第三方或本地服务时须显式指定。URL 不接受内嵌凭证、查询参数或 fragment；不要将密钥放入 query。自定义端点的网络访问策略由应用部署方管理。

`openai-completions` 默认把 `maxOutputTokens` 映射为兼容服务常用的 `max_tokens`。如果目标服务使用 `max_completion_tokens`，在该 Provider 的 `options` 中配置 `maxTokensField: 'max_completion_tokens'`；是否支持由目标模型和服务决定。

### HTTP 请求头

```ts
const config = defineProviderConfig({ providers: {
  gateway: {
    adapter: 'openai-completions',
    options: {
      baseURL: 'https://gateway.example.com/v1',
      apiKey: { env: 'MODEL_API_KEY' },
      headers: {
        'x-client-name': 'alpha',
        'x-gateway-key': { env: 'GATEWAY_KEY' },
      },
    },
    models: { chat: { id: 'your-model-id' } },
  },
} });
const model = createProvider(config).use('gateway', 'chat');
const result = await model.generate({
  messages: [{ role: 'user', content: '你好' }],
  headers: { 'x-request-id': 'request-123' },
});
```

请求头名称不区分大小写；单次 `generate.headers` 优先于同名静态配置，不修改后续请求。静态环境变量在 `use()` 时读取并随模型实例固定，轮换后需再次 `use()`；请求级 headers 直接提供字符串，每次请求各自生效。环境变量缺失时报 `SECRET_MISSING`，header 无效或违反限制时分别报 `CONFIG_INVALID` / `INVALID_INPUT`。`authorization`、`proxy-authorization`、`cookie`、`set-cookie`、`anthropic-version` 和 `content-type` 由内置适配器保留；Anthropic 还保留 `x-api-key`。Completions 和 Responses 可以注入 `x-api-key` 或 `api-key`，以便对接需要额外网关认证的服务。具体值不会出现在 Provider 的错误或 `list()` 中。自定义 adapter 自行决定如何处理 headers。

Codex 使用示例：

```ts
const config = defineProviderConfig({ providers: {
  codex: {
    adapter: 'openai-codex-responses',
    options: { accessToken: { env: 'CODEX_ACCESS_TOKEN' } },
    models: { main: { id: 'your-authorized-model-id' } },
  },
} });
```

这条路径遵循 [OpenAI 官方 Sign in with ChatGPT 指南](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)，使用自行取得的授权 token 调用公开 `/v1/responses`。本模块不读取现有 Codex 登录文件，不实现 OAuth 登录或刷新，也不直接实现 ChatGPT 内部 Codex backend 协议；需要合适的授权和受控的真实服务验证。

`OpenAIChatCompletionRequest`、`OpenAIResponseRequest` 和 `AnthropicMessageRequest` 是根据官方 API 参考整理的**当前实现字段子集**，并非官方 SDK 的完整类型；连接配置类型是 Alpha 自己的类型。参见 [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) 和 [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)。

`LanguageModel.generate()` 和 `stream()` 使用 Alpha 自己的消息和结果类型；支持文本、多轮消息、工具定义与工具调用结果、token 用量、取消信号。工具执行和循环由未来的 ADK 负责。支持的协议只是各厂商 API 的基础子集，目前没有多模态、自动重试或自动 fallback；不要假设兼容端点支持所有请求字段。

### 流式输出

```ts
const controller = new AbortController();
try {
  for await (const event of model.stream({
    messages: [{ role: 'user', content: '你好' }],
    signal: controller.signal,
  })) {
    if (event.type === 'text-delta') process.stdout.write(event.text);
    if (event.type === 'tool-call') console.log(event.toolCall);
    if (event.type === 'finish') console.log(event.result.outcome, event.result.usage);
  }
} catch (error) {
  // AbortSignal 的 reason 原样抛出；Provider 错误与 generate 一致。
  console.error(error);
}
```

`stream()` 是惰性的异步迭代：开始迭代时才发请求。文本增量是暂定内容，最终仍需检查 `finish.result.outcome`，因为流可能拒答、截断或失败。完整工具调用在最终状态确认后发出，`finish.result.toolCalls` 也包含它们；只在一处处理，避免重复执行。正常流最后有且只有一个 `finish`；网络失败、无效流或服务端报错会从迭代器抛出错误，不发送 `finish`。使用 `AbortSignal` 取消；提前 `break` 会取消响应体。Completions 用量只在上游主动返回时提供。自定义 adapter 需要实现相同契约。

### 生成结果与失败

使用 `result.outcome` 判断结果：`completed` 表示文本生成完成；`tool_calls` 表示有可处理的工具调用；`refused` 表示拒答；`incomplete` 表示生成未完成；`unknown` 表示无法确认结果状态。`text` 在拒答或不完整时也可能包含部分文本；`refusal` 和 `incompleteReason` 在服务提供信息时返回详情，`finishReason` 保留协议原始状态。只有 `tool_calls` 状态下才应执行 `toolCalls`。自定义适配器也需要实现这一结果约定。

```ts
switch (result.outcome) {
  case 'completed': console.log(result.text); break;
  case 'tool_calls': console.log(result.toolCalls); break; // 交给应用执行
  case 'refused': console.log(result.refusal ?? result.text); break;
  case 'incomplete': console.log(result.incompleteReason, result.text); break;
  case 'unknown': console.log('无法确认生成状态'); break;
}
```

服务端报告生成失败时抛出 `ProviderError`，错误码为 `RESPONSE_FAILED`；HTTP 非成功状态仍为 `REQUEST_FAILED`。错误不会包含上游错误正文。拒答内容是服务端返回的文本，展示时应按普通不可信内容处理。

### 推理模型的工具调用续接

Responses API 可通过服务端保存的响应续接上下文。以下示例假设工具调用已由应用校验和执行；`responseId` 也会出现在流式 `finish.result` 中：

```ts
const first = await model.generate({ messages, tools });
if (first.outcome === 'tool_calls' && first.responseId) {
  const toolMessages: Message[] = await runTools(first.toolCalls); // 应用实现
  const next = await model.generate({
    previousResponseId: first.responseId,
    messages: toolMessages, // 只传本次新增消息，不重复发送旧历史
    tools,
  });
}
```

`previousResponseId` 仅适用于 Responses 协议，依赖目标服务保存并支持引用先前响应；不可用于需要完全无状态或不支持服务端存储的端点。上一次请求的系统指令不会通过该字段自动延续，需要时应重新传入。响应 ID 可能关联敏感会话，应按应用的数据策略保存。

Anthropic 在返回工具调用和 thinking block 时，通过 `result.continuation` 返回完整协议数据。把它原样附在对应 assistant 消息上，再传入工具结果；流式结果同样从 `finish.result` 取得：

```ts
messages.push({
  role: 'assistant', content: first.text, toolCalls: first.toolCalls,
  continuation: first.continuation,
});
messages.push({ role: 'tool', toolCallId: first.toolCalls[0].id, content: '工具结果' });
const next = await model.generate({ messages, tools });
```

`continuation` 包含供应商返回的 thinking、签名等原始内容，可能敏感；请勿修改、打印或跨模型使用。没有 thinking block 时它可能为空。上述两种续接方式仍需对目标供应商和模型进行真实服务验证。

## 自定义适配器

通过 `createProvider(config, { adapters: { acme: acmeAdapter } })` 显式注册。`ProviderAdapter.validate(options)` 验证自定义静态选项，`createModel(options, modelId, context)` 返回我们自己的 `LanguageModel`。内置适配器不能被覆盖。自定义适配器需要自行实现请求、认证和错误处理，验证与模型创建须同步；不得记录密钥。

`ProviderError.code` 区分配置、别名、密钥、适配器、输入和请求等错误。HTTP 错误仅保留状态码，不包含响应正文；取消会透传 `AbortSignal.reason`。`createProvider` 可注入 `fetch` 和 `getEnv`，用于测试或服务端集成。

## 验证范围

通过模拟 HTTP 响应测试了三种协议的文本、流式和工具调用映射。2026-11-04 另外通过本机 `http://127.0.0.1:3425/v1`、模型 `codex/gpt-6.1-sol` 实测 Chat Completions 流式工具闭环：2 次模型调用、1 次工具执行、最终 completed，使用显式无认证配置。见 [联调记录](../../docs/adk-p0-validation.md)。该结果不代表其他端点、模型或协议都已实测。
