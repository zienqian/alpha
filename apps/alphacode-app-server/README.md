# AlphaCode App Server

AlphaCode 的独立本地业务应用，位于 `apps/alphacode-app-server`。负责 Agent 运行、会话与 SQLite 归档、消息队列、权限审批、Skills、Trace、HTTP/SSE，以及共享进程的发现、租约和后台更新。CLI、Web 和未来的桌面 App 都是客户端；服务不依赖 React、OpenTUI 或 CLI 源码。

`packages` 中的 ADK、Provider、Session、Coding Agent 和 Trace 提供可复用能力；本应用组合这些能力，定义 AlphaCode 的业务规则。可独立启动是部署边界，应用特定的会话、审批和项目配置仍归应用层所有。

职责类似 [Codex App Server](https://learn.chatgpt.com/docs/app-server)：将有状态的 Agent 能力通过协议提供给不同界面。当前沿用 AlphaCode HTTP/SSE 协议 v2，不实现 Codex JSON-RPC 协议，也不依赖 Codex。

## 启动

在仓库根目录执行：

```powershell
bun install
bun run dev:server
# 桌面启动器：发现/启动共享服务，输出 ready 后退出
bun run dev:server --ensure
# 显式选择另一份数据库
bun run dev:server --database C:/work/alphacode/sessions.db

# 构建后启动
bun run build
bun run start:server
```

服务只监听 `127.0.0.1` 随机端口。数据库选择顺序是 `--database`、`ALPHACODE_DB`、全局 `config.yaml` 的 `databasePath`、`~/.alphacode/sessions.db`；`ALPHACODE_HOME` 可修改全局配置目录。显式路径和环境变量相对启动目录，配置内路径相对配置目录。启动服务无需模型配置，也不会启动 TUI、创建会话或请求模型。

就绪后 stdout 输出一条 JSON，含 `event: "ready"`、`origin`、`protocolVersion`、`pid`、`descriptorPath`。原生客户端从私有 descriptor 读取 token；日志不输出凭证。相同数据库已被其他服务占用时，显式启动返回 `SERVER_ALREADY_RUNNING`；客户端应使用 `ensureServer` 发现并复用它。服务沿用空闲退出规则：无连接和未完成任务时，默认 60 秒退出。CLI 仍然按需自动启动服务，无需预先运行此命令。

## AlphaCode 内部集成入口

| 入口 | 用途 |
| --- | --- |
| `@alpha/alphacode-app-server/client` | 原生客户端连接、发现服务、HTTP/SSE、Chat 适配器 |
| `@alpha/alphacode-app-server/contracts` | Chat 状态与界面所需类型，无运行时依赖 |
| `@alpha/alphacode-app-server/protocol` | 协议版本与 SessionView 等 wire 类型 |
| `@alpha/alphacode-app-server/config` | 应用配置类型 |
| `@alpha/alphacode-app-server/settings` | 全局配置读取、校验与默认值 |
| `@alpha/alphacode-app-server/errors` | 配置错误与稳定错误码 |
| `@alpha/alphacode-app-server/testing` | 仅供 AlphaCode 集成测试使用的业务工厂 |

这些入口服务于同一 AlphaCode 产品的客户端集成。生产 CLI 通过 `/client` 连接服务，组件仅消费 `/contracts`；业务工厂没有根导出，lint 禁止生产 CLI 导入 `/testing`。基础包和其他应用不能反向依赖本服务。Web 继续使用同源 API，不加载 Bun、SQLite 或服务端实现。[AlphaCode App](../alphacode-app/README.md) 使用 Electron 承载同一 Web 界面，主进程通过 `--ensure` 发现服务，读取私有 descriptor 并转发 HTTP/SSE；凭证不进入渲染器。`--ensure` 复用原租约与服务发现逻辑，CLI 和桌面不会创建各自的 Agent owner。

```ts
import { ensureServer, createNativeClient } from "@alpha/alphacode-app-server/client";

const descriptor = await ensureServer(databasePath);
const client = createNativeClient(descriptor);
const info = await client.request("/api/info");
```

源码开发使用 `alpha-source` 导出条件；默认导出指向 `dist`。本次独立化仍针对 monorepo：后台更新依赖仓库布局、Bun 和 workspace 依赖，Web 静态资源来自 `apps/alphacode-web/dist`。尚未制作可脱离仓库分发的桌面 sidecar 安装包。

## 兼容与验证

数据库路径、namespace、归档格式、协议 v2、鉴权和请求去重规则保持不变。已有活跃服务仍可复用，不会因目录迁移强行接管。完整退出后，新客户端从本应用启动服务。API 与一致性约定见 [协议文档](src/server/README.md)。

```powershell
bun --bun run nx run-many -t build,typecheck,lint,test --projects=@alpha/alphacode-app-server,@alpha/alphacode
```

测试使用本地 HTTP、临时 SQLite 和离线模型夹具，覆盖独立进程启动、CLI 共享、流式快照、审批、恢复、队列与后台更新，不访问真实模型。

源码变化由 supervisor 自动检测，在生成、审批、队列和保存完成后交接运行状态。新代码加载或恢复失败时继续使用原 worker，并按 5 / 10 / 20 / 30 秒退避自动重试（实际时间受检查周期影响）；后续源码修改会立即进入新一轮检测。页面不提供更新操作。前端开发使用 `bun run dev:web` 或 `bun run dev:app`，由 Vite 独立处理 HMR，不依赖后端版本轮询或手动刷新。
