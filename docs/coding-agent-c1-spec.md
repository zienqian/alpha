# Coding Agent C1 实现规格

基于已评审的 `coding-agent-design-c1.html`，2026-11-04。

## 边界与 API

- 新增 `@alpha/coding-agent`：`createCodingAgent` 是 `createAgent` 的薄组合，返回普通 core Agent；执行入口始终为 `agent.prompt`。
- `createWorkspacePlugin` 注册六个工具、权限钩子、不可变执行计划和 Agent 生命周期工作区租约。
- `createProjectInstructionsPlugin` 只在启动时读取根目录 AGENTS.md（默认 32 KiB），通过 beforeModel 临时投影；不写正式历史。
- Session 仍由应用通过 `createSessionPlugin({ session })` 组合，Coding 包不依赖 Session，不增加 Loop 或消息协议。
- `/node` 提供 `createLocalWorkspace`。C1 的已实现平台为 Windows + PowerShell 7 + ripgrep；其他平台或 shell 明确拒绝，外部可实现 CodingWorkspace。`isolation: 'none'`。

## 工具与执行事实

`read_file(path,startLine?,lineCount?)`、`list_files(glob?,limit?)`、`search(query,glob?,limit?)`、`edit_file(path,oldText,newText)`、`create_file(path,content)`、`run_command(command,cwd?,timeoutMs?)`。schema 为单层严格对象；search 是字面文本搜索。

读文件记录整个文件的字节版本；编辑要求本 Agent 观察过文件、非空且唯一的精确 oldText。创建不覆盖、不自动建目录。计划包含规范路径、参数、预期版本和预览，审批后重新检查版本。已知冲突以 `{ok:false,code}` 返回；不能确认写入或命令效果时抛出，让 core 记录 outcome_unknown 并阻断后续执行。

默认读、搜索、编辑、创建 allow；命令 ask；扩展工具 custom deny。缺失审批回调等于 deny；异常 fail closed；取消后的迟到同意不执行。审批与执行绑定同一计划。

## 本地适配器

- 路径必须相对；拒绝逃逸、绝对路径、UNC、ADS、重解析点；写入前复查父目录。仅用于可信协作工作区，不声称防止恶意 TOCTOU 或 shell 越权。
- 文件默认上限 1 MiB；UTF-8 严格解码并保留 BOM/换行。修改同目录临时文件后原子替换；创建使用独占创建语义。版本检查不等于跨外部进程的文件系统 CAS。
- 规范根目录标识跨实例稳定；OS 独占文件句柄提供跨进程租约，不按 Session ID 分锁。Agent.close 排空操作并释放租约，workspace 由应用关闭。
- Windows bridge 用 suspended CreateProcess + Job Object 在执行前绑定完整进程树；命令超时或取消终止 Job 并等待所有成员退出；租约释放等待排空。宿主断开 stdin 时同样清理 Job。
- 环境使用显式白名单和应用覆盖；固定 PowerShell 7，无 profile、无交互；输出默认 48 KiB，命令超时默认上限 60 秒。
- 默认 preset：24 model calls、64 tool calls、180 秒；结果序列化后限额，保存写入版本和 exitCode 等效果事实。结果预算低于 4096 字节在创建时拒绝；手动装配的插件通过 maxResultBytes 与 core 对齐。

## 验收

1. 插件组合、六工具 schema、默认拒绝命令、审批绑定/取消、已知冲突与未知效果、指令投影、输出限额。
2. 真实文件 BOM/CRLF、路径/链接逃逸、版本冲突、原子写入、跨进程租约、命令 exit 1、超时/取消回收孙进程、关闭排空。
3. Session 重放不重复写文件或执行命令；Coding 不依赖 Session。
4. 本地 `http://127.0.0.1:3425/v1` / `codex/gpt-6.1-sol` 在临时 fixture 完成读取—修改—测试，独立验证结果。
5. 全 workspace build/typecheck/lint/test；发布入口与 API 示例使用真实声明检查。

Windows 实现参考：[Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)。
