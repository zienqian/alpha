# @alpha/adk-context

可选的模型上下文预算、会话摘要与检查点扩展。`createContextManager` 通过 core 的 `provideModelContext` 投影历史，不改写正式消息；SQLite 检查点在 Session 事实成功归档后由宿主调用 `persist` 保存。详细行为见 [上下文设计](../../docs/context-management-design.md)。

## 显式引用与回读

```ts
import { createContextReader, referenceForMessage } from '@alpha/adk-context';
import { createSqliteArtifactStore } from '@alpha/adk-artifact/sqlite';

const scope = { namespace: 'project', sessionId: 'session' };
const artifacts = createSqliteArtifactStore('/data/sessions.db.artifacts.db');
const readContext = createContextReader({ scope, artifacts, messages: () => agent.state.messages });
const reference = await referenceForMessage(scope, agent.state.messages[0]);
const page = await readContext({ reference, maxBytes: 4096 });
```

消息引用指向完整正式消息的 JSON（包括 ID、角色、工具调用身份和 execution），校验精确内容；内容变化返回 `CONTEXT_CONTENT_MISMATCH`，来源不存在返回 `CONTEXT_NOT_FOUND`。`messages` 必须提供当前会话的正式历史或已恢复归档，不能传压缩后的模型投影。Artifact 引用交由同一作用域的 ArtifactStore 解析。

摘要输入为带 `reference` 的来源消息，要求重要约束与证据保留完整引用。结构校验拒绝摘要中未出现在输入里的标准引用；引用正文仍须在回读时验证来源和内容，不能只信任摘要文本。旧检查点及没有引用的摘要仍兼容。摘要本身不自动展开全部证据；AlphaCode 通过 `read_context` 按需读取，分页和容量规则由 Artifact 包统一定义。

SDK 使用者可将 `readContext` 传给 `createCodingAgent`，或通过自有只读工具提供。引用不授予权限，回读文本作为历史证据，不作为新指令。检查点与 ArtifactStore 均由宿主负责关闭和随会话删除。

宿主可通过 `toolInputReferences(history, signal)` 返回 `{assistantId, callId, field, reference}`，在确认内容已保存并可回读后，将成功工具调用的大段字符串参数投影为引用。预算统计、保留历史和摘要输入使用同一投影；原始消息、来源哈希和归档保持完整。Core 校验调用与成功结果的配对，并拒绝替换带 provider continuation 的消息。此回调不保存内容，也不验证引用是否存在，宿主必须先验证可用性；保存失败或来源不可读时应保留原参数。
