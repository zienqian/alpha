# alphacode P0 验收记录

日期：2026-11-04。功能实现可试用；发布验收尚有 Windows Terminal 人工项。源码见 `apps/alphacode`，启动方式见 [应用 README](../apps/alphacode/README.md)。

## 环境与运行时

Windows 11 专业版 10.0.26200，x64，AMD Ryzen 7 5800H。Node 26.13.0、pnpm 9.15.1、OpenTUI Core/Solid 0.8.2、SolidJS 1.9.18、better-sqlite3 13.0.3、YAML 2.9.1；精确依赖见锁文件。Node 26 单独安装，由项目 `.node-version` 选择；没有替换用户的 fnm 全局默认 Node 20。

OpenTUI 使用 Node FFI 后端与 Solid universal transform；生成代码指定客户端 Solid runtime。better-sqlite3 12.4.1 的 Node 20 ABI 文件不能用于 Node 26，因此开发依赖与应用固定到 13.0.3。该版本自带 N-API 预编译文件，已验证直接加载；pnpm 9 会根据 binding.gyp 误触发编译，根 `neverBuiltDependencies` 只针对这个包禁用该步骤。

`pnpm install --frozen-lockfile` 成功。`bun-ffi-structs` 声明 TypeScript ^5 peer、仓库使用 TypeScript 6，会产生 peer 提示；当前 Node 路径构建与类型检查均通过，没有降低整个仓库的 TypeScript 版本。

## 构建与自动化

全仓库 `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；覆盖 6 个项目构建和 5 个测试目标。后续应用边界修正重新运行应用 build/typecheck/lint/test，17 项测试全部通过；Provider 的 26 项测试也通过，包含 4 种协议的直接凭证鉴权、环境查找零调用与敏感值脱敏。

| 证据 | 已验证内容 |
| --- | --- |
| `test/cli.test.mjs` | 从仓库外执行 help/version；不加载原生 renderer；非 TTY 退出 2；拒绝配置参数；只有 bin、无 exports/main/types |
| `test/projection.test.mjs` | 多段 delta 替换为单份规范文本；跨 run/assistant 重用 callId 不串卡；无 tool.start 的拒绝；读取真实行号与截断；一次性审批取消 |
| `test/runtime.test.mjs` | 固定 home YAML、首次模板不覆盖、重复键/凭证错误、完整模型 ID、不采用 ADK_MODEL；延迟会话、重复提交门禁、新草稿保留；命令批准前执行数 0；非零退出保持失败；保存失败后只 flush、执行计数不变；重建 runtime 后 pending 只读；分页与工作区隔离、最近保存书签；鉴权错误脱敏、失败输入恢复 |
| 真实 Windows 工作区夹具 | 读取 → 精确编辑 → 批准 PowerShell 测试 → exit 0 / PASS → SQLite 保存 → 重开 → 有历史的第二轮 |
| 真实取消夹具 | 命令创建父/子进程；取消后两个 PID 均不可存活（ESRCH）；归档 unknown 与只读状态；并发退出不重复清理；退出后新工作区租约可获得 |
| `test/ui.test.mjs` | 原生 OpenTUI：中文 20 行 bracketed paste 不提交、快捷键与 Slash 路由、审批默认拒绝、120×40 / 80×24 / 60×18 / 40×12 缩放；最多 200 块；上翻不被新消息拉走；End 返回最新 |
| 既有 Session / Coding 测试 | Session 51 项：SQLite CAS、竞争、重开、busy/rollback 等；Coding 37 项：真实取消/超时/主进程死亡时子孙进程 drain、独占租约、文件版本冲突与六工具事实 |

性能样本使用 `testRender` 的真实原生渲染后端：30 Hz 离线 model delta，同时每 33ms 注入一个中文字符；从注入到 frame flush 并捕获文字，共 30 个样本。两次通过记录 P95 为 46.18ms、33.78ms，低于 100ms 目标。此数据**不是**物理键盘、Windows IME 或 Windows Terminal 的端到端延迟。

## 真正 PTY 的终端协议检查

使用 `exec_command(tty:true)` 启动 `node --experimental-ffi -- apps/alphacode/integration/terminal-fixture.mjs`，stdin/stdout 均为 TTY，80×24。发送中文双行 bracketed paste，确认仅插入输入框；显式 Enter 后进入默认拒绝审批；Tab + Enter 允许离线夹具命令；Ctrl+C 退出。

```json
{"code":0,"rawBefore":false,"rawAfter":false,"modelCalls":2,"fixtureCommands":1,"leasesBalanced":true}
```

退出输出包含关闭 bracketed paste、鼠标报告、alternate screen 并恢复光标的终端序列。此夹具的模型和命令是离线替身；真实命令事实由上面的 Windows 集成测试覆盖。这是 PTY 协议验收，不冒充 GUI 输入法选字测试。

## 已授权本地模型

运行 `node apps/alphacode/integration/local-model.mjs --run`，使用用户指定的 `http://127.0.0.1:3425/v1` 与完整模型 ID `codex/gpt-6.1-sol`。临时 YAML 经相同配置模块加载；不使用 `.env`，不修改用户真实配置。

```json
{"status":"passed","date":"2026-11-04T14:04:34.307Z","node":"v26.13.0","endpoint":"http://127.0.0.1:3425/v1","model":"codex/gpt-6.1-sol","modelCalls":6,"approvedCommands":2,"fileChanges":1,"beforeExit":1,"afterExit":0,"testsUnchanged":true,"sqliteReopened":true,"reopenModelCalls":0,"turns":2,"elapsedMs":32221}
```

模型先看失败证据，最小修改 `pagination.cjs`，再次测试通过；原始测试文件逐字不变。runtime、workspace、SQLite 关闭后重新创建，打开归档调用模型 0 次，随后第二轮依据历史回答。探针只自动批准固定的 `node --test pagination.test.cjs`；真实交互审批行为由原生 UI 与 PTY 夹具另行验证。临时项目、配置、SQLite 与书签均清理。

## 发布 Gate 状态

1. 真实修复、测试、归档、退出重开与继续：通过自动化/本地模型。
2. 取消、进程树、租约、终端模式恢复：通过真实工作区与 PTY。
3. 保存故障与零重复副作用：通过。
4. pending / unknown 只读隔离：通过。
5. 输入与阅读：原生与 PTY 项通过；Windows Terminal 输入法选字的 Enter 行为待人工验收。
6. 产物、cwd、仅 CLI 边界：通过自动化。

## 待人工确认

T01/T06 的剩余人工部分与 T24 保持未勾选：Windows Terminal 的中文 IME 选字 Enter、emoji 组合、真实长粘贴、持续输出期间物理键盘 P95、GUI 缩放和退出后继续使用 shell。现有测试不证明这些全部通过。

本次 Computer Use 技能配套规则禁止 “Do not automate terminal applications such as Windows Terminal, Command Prompt, or Windows PowerShell.”，因此没有用桌面自动化伪造人工验收。已采用允许的进程/PTY 测试补足可自动验证部分；不需要用户授权额外权限才能试用 CLI。

人工建议流程：运行上述离线 `terminal-fixture.mjs`，输入法选字应留在输入框，按 Ctrl+J 换行；确认命令审批默认拒绝；缩放到 60×18 后仍能拒绝/取消；退出后 shell 光标、方向键与回显正常。真实项目测试再通过 `pnpm alphacode --cwd <项目>` 进入。
