# Coding Agent R3 验证记录

2026-11-06，Windows，Bun 1.4.4。实现依据 [R3 评审](coding-agent-refactor-review.html)，使用方式见 [包说明](../packages/coding-agent/README.md)。

## 全仓检查

- `bun run build`：6 个目标成功。
- `bun run typecheck`：10 个目标成功（含依赖构建）。
- `bun run lint`：6 个目标成功。
- `bun run test -- --output-style=static`：5 个测试项目及依赖构建成功；未修改的基础包使用 Nx 缓存。Coding Agent 41 项、AlphaCode 10 项在本轮实际运行，均通过。

## 实测范围

- Windows PowerShell 5.1 和 PowerShell 7：中文/emoji、纯文本 stderr、引号、非零 Shell 退出码、显式 `exit $LASTEXITCODE`。
- Windows cmd 和 Git Bash：真实调用带空格参数的 Bun 脚本、UTF-8 原生程序输出与 stderr。cmd 使用 verbatim 参数及外层引号，避免 C runtime 转义破坏命令。
- 启动前取消、缺失程序、无效 cwd 均不宣称已执行；cross-spawn 启动 cmd 后报告 ENOENT 仍归为 not_started。
- 真实父子孙进程取消/超时、Shell 子进程取消；根进程退出后后代保留管道，1 秒后返回 outputIncomplete。
- UTF-8 分块、双通道截断、截断后继续排空且不拼接后续碎片、环境密钥不继承。
- PATH 清空后仍能创建 Agent 并读取文件；调用搜索时才返回 RIPGREP_NOT_FOUND。
- 文件 BOM/CRLF、只创建、版本冲突、链接和路径拒绝、二进制和超限拒绝、ignore/glob/字面搜索。
- 同一静态工具在不同 cwd 下隔离；同 cwd 两个 Agent 可并存；读取不依赖审批计划，写入要求批准的调用；审批拒绝/异常/晚到取消不执行。
- Session 保存失败后 flush、重挂及 requestId 重放不重复工具；AlphaCode 的输入、流式 Markdown、命令审批、取消、SQLite 归档和旧 namespace 规则通过。
- 当前源码和 dist 中无旧 Workspace/bridge 实现文件。

## 边界

macOS/Linux 的选择顺序有单元测试，未在这两种系统上实际运行。本轮未运行付费或联网真实模型修复探针；普通回归通过离线模型驱动真实工具。

不再承诺 C1 的独占目录锁、Windows Job Object 或宿主强杀后的完整后代清理。并发外部写入仍不是原子 CAS；主动脱离进程组、已退出父进程的脱离后代不保证完整回收。

自动审批拒绝了空目录删除命令；旧代码和生成文件已通过逐文件修改删除，本机可能留下空的 src/local、dist/local 目录，Git 不记录空目录。
