> 历史 C1 验收记录：以下 Workspace 租约、Job Object 与宿主死亡清理结论不适用于 R3。当前实现见 [R3 说明](../packages/coding-agent/README.md)及 [R3 验证记录](coding-agent-r3-validation.md)。

# Coding Agent C1 验收记录

日期：2026-11-04。本机 Windows、Node 20.20.2、PowerShell 7、ripgrep。

## 交付

新增 `@alpha/coding-agent` root 与 `/node` 两个入口。三个组合 / 插件工厂、一个本地适配器工厂，六个工具、静态权限策略、一次性审批、根 AGENTS.md、工作区租约。core、Session、Provider 运行实现无修改；Coding 只有一套 core Loop，Session 仍通过 `createSessionPlugin({ session })` 接入。

## 自动化证据

`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全仓通过；后续输出边界补强再次通过 Coding 包 build/typecheck/lint 和完整测试。

| 包 | 通过 | 失败 / 跳过 |
| --- | ---: | ---: |
| Provider | 25 | 0 / 0 |
| ADK core | 83 | 0 / 0 |
| Session | 51 | 0 / 0 |
| Coding Agent | 37 | 0 / 0 |
| 合计 | 196 | 0 / 0 |

真实 API 示例针对 dist 声明检查；产物依赖图验证根入口不加载 Node 适配器、Session 或 Provider 运行时。HTML 离线链接 / API 附件一致性通过，Chrome 桌面 1440px / 移动 390px 共 10 项交互检查通过，无横向溢出、脚本异常或 HTTP 请求。

本地详细日志位于 `.nx/coding-c1-*.log`，浏览器截图及检查记录位于 `.nx/coding-design-qa/`；这些运行产物不提交。大搜索输出、JSON 转义、Unicode 截断和异步观察异常已覆盖。

覆盖插件与产物边界、单 schema、指令临时投影、审批异常/迟到批准、精确编辑/版本冲突、结果预算、未知效果阻断、Session 重放与补写。Windows 实测 BOM/CRLF、二进制和 UTF-8 拒绝、junction/路径逃逸、独占创建、跨进程 OS 锁、宿主死亡释放、stdout/stderr/exit 1、秘密环境变量不继承、正常进程树排空、取消/超时回收 detached 子进程和孙进程。

进程树测试显式使用 detached + 独立 stdio，使子进程确实能在 Node 父进程退出后存活，再验证 Job 收束；参见 [Node child_process 文档](https://nodejs.org/api/child_process.html#optionsdetached)。Windows 机制参见 [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。

## 真实模型修复

命令：`node --env-file=.env.local packages/coding-agent/integration/live.js`。

2026-11-04T11:43:35.349Z，在临时项目通过 `http://127.0.0.1:3425/v1`、`codex/gpt-6.1-sol` 完成：

- 5 次模型调用，2 次已批准测试命令，1 次源文件修改。
- 初始分页边界测试退出码 1；修复后模型运行测试退出码 0，宿主再次独立运行也为 0。
- 测试文件逐字未改。3 个测试验证空页、短页、满页；只修复源文件边界条件。
- Session 保存 revision 2；同 Agent 重放和关闭后重新接入都复用结果，额外模型调用与文件/命令副作用均为 0。
- 总耗时 25,262 ms。测试 fixture 完成后清理。

## 当前边界

C1 本地适配只支持 Windows + PowerShell 7；Linux/macOS/Bash 明确拒绝。`isolation: none`，命令具备用户权限，不能当 OS 沙箱。精确替换不承诺面对恶意外部并发的文件系统 CAS；不提供多文件事务、Git checkpoint、持久审批、目录级 AGENTS.md、MCP 或 CLI。Windows 文件 ACL / 扩展元数据不承诺完整保留。宿主原地修改项目指令后需重建 Agent，并自行维护兼容 agentKey。
