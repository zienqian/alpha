# @alpha/adk-artifact

可选的会话证据存储。提供内存与 Bun SQLite 实现，保存不可变 UTF-8 文本、内容校验值、完整性标记和来源。包不依赖 ADK、Session、Provider 或应用层；调用方持有并关闭 SQLite 连接。

```ts
import { createSqliteArtifactStore } from '@alpha/adk-artifact/sqlite';

const store = createSqliteArtifactStore('/data/sessions.db.artifacts.db');
const scope = { namespace: 'project', sessionId: 'session' };
try {
  const artifact = await store.put(scope, {
    content: 'exact command output\n',
    complete: true,
    source: { runId: 'run', assistantId: 'assistant', callId: 'call', channel: 'stdout' },
  });
  const page = await store.read(scope, { reference: artifact.reference, maxBytes: 4096 });
  // page.hasMore 为 true 时，使用 page.nextOffset 继续。
} finally { store.close(); }
```

`put`、`read`、`list`、`remove` 都显式传入 namespace / sessionId。`remove` 删除该会话的全部产物并保留墓碑，拒绝并发旧连接的后续写入；不影响其他会话。没有跨会话检索、自动执行或覆盖已有产物的接口。

引用格式为 `context://<scope-sha256>/<artifact|message>/<encoded-id>?sha256=<content-sha256>`。作用域摘要由 namespace / sessionId 生成；引用只用于定位和校验，不是身份认证凭证。读取必须同时通过宿主传入的当前会话范围和完整内容的 SHA-256 校验，不能将 URI 当成本地路径。消息引用的创建和解析由 `@alpha/adk-context` 提供。

单个 Artifact 最多 8 MiB；每个会话最多 128 MiB 正文和 10,000 个产物。达到限制返回明确错误，不淘汰旧证据。每页 4–4096 字节，`offset` 从 0 开始，必须位于 UTF-8 字符边界；`nextOffset` 保证可用于下一页。`hasMore` 只表示当前存储内容还有下一页；`complete=false` 表示原始采集不完整，即使已读到最后也不代表完整日志。

SQLite 存储在独立文件中，不修改 Session 归档格式或 revision。删除清除逻辑记录，SQLite 可能保留可复用空间，不承诺安全擦除。文本按原样存储；该版本不提供二进制附件、加密、跨会话索引或运行中的崩溃日志恢复。

主要错误码：`CONTEXT_REFERENCE_INVALID`、`CONTEXT_SCOPE_MISMATCH`、`CONTEXT_NOT_FOUND`、`CONTEXT_CONTENT_MISMATCH`、`CONTEXT_RANGE_INVALID`、`ARTIFACT_TOO_LARGE`、`ARTIFACT_STORAGE_LIMIT`、`ARTIFACT_SCOPE_DELETED`。
