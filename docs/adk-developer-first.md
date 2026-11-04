# Alpha ADK：先从开发者怎么用开始

> API 设计草案 · 2026-11-03  
> 下面的 `@alpha/adk` API 都是拟议用法，尚未实现。目标是先让开发者能写出 Agent，再确定内部架构。

## 1. 我们要让开发者做什么

一个开发者要做订单助手，只需完成四件事：

1. 从现有 `@alpha/provider` 选择模型。
2. 写一个查询订单的工具。
3. 创建 Agent，把模型和工具交给它。
4. 调用 Agent，获得回答；需要时订阅流式事件。

开发者不需要先理解内核、网关、策略或插件宿主。

## 2. 完整示例：一个订单助手

```ts
import { createProvider } from '@alpha/provider';
import { Agent, tool } from '@alpha/adk';
import { z } from 'zod';

// 1. 选择模型：沿用当前 Alpha Provider
const provider = createProvider({
  providers: {
    primary: {
      adapter: 'openai-completions',
      options: { apiKey: { env: 'MODEL_API_KEY' } },
      models: { chat: { id: 'your-model-id' } },
    },
  },
});
const model = provider.use('primary', 'chat');

// 2. 定义工具
const getOrder = tool({
  name: 'get_order',
  description: '查询指定订单的状态',
  parameters: z.object({
    orderId: z.string().describe('要查询的订单号'),
  }),
  async execute({ orderId }) {
    // 实际项目中在这里调用订单服务，并校验当前用户权限
    const order = await orderService.getById(orderId);
    return JSON.stringify(order);
  },
});

// 3. 创建 Agent
const agent = new Agent({
  name: 'order-assistant',
  instructions: '帮助用户查询订单状态。查询前使用工具获取信息，不要编造。',
  model,
  tools: [getOrder],
});

// 4. 发起对话
const result = await agent.prompt('帮我查询订单 A123');
if (result.status === 'completed') {
  console.log(result.text);
} else {
  console.log('本次运行未正常完成：', result.status);
}
```

`orderService` 是应用已有的业务服务，由应用导入或注入；示例省略其具体实现。Zod 是示例 schema 库，是否作为首版依赖尚待决定；上面的自动推导、校验和 JSON Schema 转换是预期能力，不是现有功能。

**执行过程：** ADK 把用户消息、指令和工具描述发给模型；模型选择调用 `get_order`；ADK 校验参数并执行函数；工具结果返回模型；模型生成最终回答。订单查询失败或模型拒答不会被当成成功回答。

## 3. 多轮对话怎么写

同一个 Agent 实例保留自己的消息历史：

```ts
const first = await agent.prompt('查询订单 A123');
// completed: “订单 A123 正在配送中。”

const second = await agent.prompt('它是什么时候发出的？');
// Agent 可以使用前一轮历史继续回答。

console.log(agent.state.messages);
```

一个 Agent 实例一次只运行一个 `prompt`；同一实例并发调用时报明确错误。不同 Agent 实例各自拥有独立历史。默认历史只在内存中，进程退出后丢失；持久化属于可选能力。

## 4. 流式输出和取消

```ts
const controller = new AbortController();

const unsubscribe = agent.subscribe((event) => {
  if (event.type === 'text.delta') process.stdout.write(event.text);
  if (event.type === 'tool.start') console.log('\n正在调用：', event.name);
});

try {
  const result = await agent.prompt('查询订单 A123', {
    signal: controller.signal,
  });
  if (result.status !== 'completed') {
    console.log('运行结束：', result.status);
  }
} finally {
  unsubscribe();
}

// 需要停止时：controller.abort()
```

流式文本在最终结果确认前只是增量；调用方仍需检查 `result.status`。取消会停止后续工作，但不能撤销已经完成的业务操作。事件订阅用于展示和观察，不能代替工具授权。

## 5. 开发者最常见的扩展

### 5.1 添加或替换工具

```ts
const searchProducts = tool({
  name: 'search_products',
  description: '搜索商品',
  parameters: z.object({ keyword: z.string() }),
  async execute({ keyword }) {
    return JSON.stringify(await productService.search(keyword));
  },
});

const agent = new Agent({
  name: 'shop-assistant',
  instructions: '帮助用户查询订单和商品。',
  model,
  tools: [getOrder, searchProducts],
});
```

工具是普通 TypeScript 函数加名称、描述和输入 schema。ADK 在执行前校验模型生成的参数；业务服务仍负责用户身份、数据权限和自身副作用。

### 5.2 切换模型

```ts
const model = provider.use('anotherProvider', 'chat');

const agent = new Agent({
  name: 'order-assistant',
  instructions: '帮助用户查询订单状态。',
  model,
  tools: [getOrder],
});
```

工具代码不需要修改。不同服务的能力和协议续接并不完全相同；新建 Agent 切换模型较简单，已有历史中包含特定模型的续接数据时必须先检查能否安全转换，不能承诺所有历史都可无损迁移。

**实现要求：** ADK 与 Provider 保持独立包。上面的直接传入能否通过结构类型实现，需要用现有 `LanguageModel` 做类型 POC；如果不能，应提供单独的 bridge，并调整示例中的导入，不能为了示例好看强行增加两包依赖。

### 5.3 在工具执行前加权限控制

```ts
const agent = new Agent({
  name: 'order-assistant',
  instructions: '帮助用户查询订单。',
  model,
  tools: [getOrder],
  hooks: {
    async beforeToolCall({ toolName, args }) {
      const allowed = await permissions.canUse(currentUser, toolName, args);
      if (!allowed) return { allow: false, reason: '没有权限执行此操作' };
      return { allow: true };
    },
  },
});
```

hook 在参数校验后、工具执行前运行；拒绝时不调用工具。抛错按拒绝处理。具体拒绝后是结束 run 还是把安全的拒绝结果交给模型，应作为明确配置，而不是由模型决定。参数和用户身份来自可信应用上下文，不应默认写入日志。

### 5.4 接入自己的上下文处理

当历史过长或需要检索知识时，开发者可以更换模型调用前的上下文构建方式：

```ts
const agent = new Agent({
  name: 'support',
  instructions: '根据知识库帮助用户。',
  model,
  tools: [],
  context: {
    async build({ messages, signal }) {
      const docs = await knowledgeBase.search(latestUserText(messages), { signal });
      return addReferenceMessages(messages, docs);
    },
  },
});
```

`knowledgeBase`、`latestUserText` 和 `addReferenceMessages` 是应用提供的示意函数。返回的是本次发给模型的上下文投影，不直接覆盖原始历史；工具调用和结果不能被裁剪成不匹配的消息对。

### 5.5 将多个能力打包成插件

多个 Agent 想复用同一组工具和 hooks 时，才需要插件：

```ts
const orderPlugin = definePlugin({
  name: 'orders',
  setup(api) {
    api.addTool(getOrder);
    api.on('beforeToolCall', async ({ toolName, args }) => {
      const allowed = await permissions.canUse(currentUser, toolName, args);
      return allowed ? { allow: true } : { allow: false, reason: '没有权限' };
    });
  },
});

const agent = new Agent({
  name: 'order-assistant',
  instructions: '帮助用户查询订单状态。',
  model,
  plugins: [orderPlugin],
});
```

`definePlugin` 同样是拟议 API。插件是一个组装单元，不是使用 ADK 的前提。首版若实现插件，采用显式传入、名称冲突报错、按注册顺序执行；不自动扫描或加载不可信代码。

## 6. API 总览

| 开发者想做的事 | 拟议入口 | 首版建议 |
| --- | --- | --- |
| 创建对话 Agent | `new Agent({ instructions, model, tools })` | 必需 |
| 定义工具 | `tool({ name, description, parameters, execute })` | 必需 |
| 发起对话 | `await agent.prompt(text)` | 必需 |
| 接收流式事件 | `agent.subscribe(listener)` | 必需 |
| 停止执行 | `AbortSignal` / `agent.abort()` | 必需 |
| 查询当前状态 | `agent.state` 只读快照 | 必需 |
| 模型调用/工具调用前检查 | `hooks` | 先支持少量明确 hook |
| 自定义上下文 | `context.build` | 首版定义清晰输入输出，按用例实现 |
| 复用一组工具及 hooks | `plugins` | 在基础 API 验证后实现 |
| 更换模型 | Provider 模型或 bridge | 对接现有 Provider 后验证 |
| 外部持久化、MCP、多 Agent | 独立可选适配或应用组合 | 用真实场景驱动 |

## 7. 背后如何体现微内核

开发者不需要操作内核，但应能理解它为这些 API 提供了什么保证：

```text
开发者调用 agent.prompt()
       ↓
Agent 管理当前会话与一次运行
       ↓
内核执行模型 → 工具 → 模型的循环
       ├─ 调用已注入的模型
       ├─ 校验并执行已注册的工具
       ├─ 运行授权 hook、限制次数、处理取消
       └─ 发出事件，返回明确结果
```

**内核固定机制**：消息与工具调用的关联、运行状态、取消、最大模型调用次数、工具参数校验和事件顺序。它不内置订单服务、数据库、MCP 客户端或某个模型厂商。

**外围提供能力**：工具、模型、上下文处理和可选插件通过参数注入。后续如果真实业务需要替换整个 Agent 循环，再公开低层执行接口；首版不要求普通开发者提供策略对象。

这里的微内核是设计目标，不是已通过实现验证的事实。特别是：进程内插件是可信代码，不是安全沙箱；持久化会话也不自动提供崩溃恢复或外部操作恰好一次执行。

## 8. 先实现什么，如何验证

1. 先用现有 Provider 类型做最小 POC，确定模型直接传入还是需要 bridge；同时选定 schema 方案。
2. 实现上述最小路径：Agent、tool、prompt、事件、取消和最大模型调用次数。
3. 用 mock 模型验证“模型调用工具 → 工具返回 → 模型回答”，再验证多轮历史、参数错误、工具失败、拒答和取消。
4. 在两个目标模型服务上受控验证流式、工具调用与协议续接，不假设兼容协议端点行为完全一致。
5. 至少出现第二个真实使用场景后，再验证插件、上下文替换及其他抽象是否真的降低接入成本。

**需要我们一起决定的两个 API 细节：**工具 schema 是否首版采用 Zod；模型是直接接收现有 Provider 实例，还是使用独立 bridge。其他示例中的具体命名可以在实现 POC 时调整。

