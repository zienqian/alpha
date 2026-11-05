# Coding Agent 实现规格（R3）

2026-11-06，替代 C1 的 Workspace/租约/Windows bridge 结构。评审依据：[R3 HTML](coding-agent-refactor-review.html)。完整参数和限制见 [包说明](../packages/coding-agent/README.md)。

- `createCodingAgent({ model, cwd, shell?, tools?, appContext?, policy?, approve? })` 返回普通 core Agent；内部使用同一套 Loop。
- cwd 在启动时 realpath 规范化。工具是模块常量，只从每个 Agent 的 `ctx.app` 获取 cwd、Shell、data 和执行状态；没有工具工厂、Workspace 服务或目录租约。
- 每个工具拥有 schema、预检和执行。读取直接运行；写入和命令执行同一次调用批准的不可变计划。审批 digest 绑定 cwd、Shell、参数、预期版本和预览。
- Shell 在调用模型前解析；Windows 可使用 PowerShell 7、系统 Windows PowerShell、Git Bash 或 cmd，macOS/Linux 使用受支持的 POSIX Shell。缺少 Shell 不妨碍文件工具，缺少 rg 只影响搜索和列表。
- 使用 cross-spawn 7.0.6；Windows taskkill /T /F，Unix 进程组 TERM → 3 秒 → KILL，输出 close 等待最多 1 秒。保留流式 UTF-8 双通道输出并持续排空，明确标记截断及输出不完整。
- 预启动失败是 not_started，已启动取消/超时是 unknown；Shell 的非零退出是正常工具结果。未知副作用交给 core 阻断，不重试。
- 文件保留 UTF-8/BOM/CRLF、路径/链接检查、读取版本、临时文件写入与提交前复查；移除独占目录锁，不承诺外部并发下原子 CAS。
- AlphaCode 继续通过 Session 插件归档，保留原有 Windows 会话 namespace、目录参数优先级与关闭补写行为；资源顺序 Agent → Session → Store。
- 文档示例针对真实 dist 声明检查。测试覆盖真实文件、审批冲突/取消、静态工具隔离、Shell 选择、输出/退出码、进程树取消与管道 drain，以及 Session 重放不重复副作用。

本轮 Windows 实测与 macOS/Linux 运行验证分开记录；选择逻辑单元测试不等同于非 Windows 真机验证。历史 Job Object/宿主死亡清理的 C1 验收不能用于宣称 R3 具有同等保证。
