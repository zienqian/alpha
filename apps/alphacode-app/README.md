# AlphaCode App

Electron 桌面外壳，开发时连接 `apps/alphacode-web` 的 Vite 服务，发行时加载同一页面的构建产物。
聊天、Tiptap 输入、搜索、审批、队列、Skills、Trace、主题和语言与 Web 使用同一份实现。
源码工程为 `apps/alphacode-app`，包名为 `@alpha/alphacode-app`；窗口、菜单及分发程序统一使用产品名 **AlphaCode**。

桌面标题栏与工作区外壳同色（36px），保留原生窗口按钮、拖动和双击最大化。浅深主题通过隔离的 preload 同步窗口配色；preload 仅暴露平台与配色方法，不开放通用 IPC 或窗口控制权限。浏览器不显示桌面标题栏。

品牌图标使用 ALFI 的二维专注表情。`assets/icon.ico` 用于 Windows 窗口和可执行文件，`assets/icon.icns` 用于 macOS 应用包，`assets/icon.png` 用于 Linux 窗口和 macOS Dock；打包时会携带这些资源，移动发行目录后仍可加载。网页 favicon 和侧栏图标来自 `../alphacode-web/public/icons`。原始图稿与资源导出说明见 [图标说明](../../docs/brand/alphacode-icon-v1/README.md)。

## 运行与打包

```powershell
# 仓库根目录，Bun 1.4.4
bun install --frozen-lockfile
bun run dev:app

# 构建 Web 页面、Electron 主进程和 preload
bun run build:app

# 打包当前系统/架构的独立应用目录，需要本机 rg 或 ALPHACODE_APP_RG
bun run package:app
& ".\apps\alphacode-app\dist\AlphaCode-win32-x64\AlphaCode.exe"
```

`dev:app` 自动启动 Vite、连接共享 App Server 并打开 Electron，无需先构建 Web。保存 React / CSS 后自动更新页面；修改 Electron 主进程后自动重新构建并重启窗口。页面不显示更新横幅、刷新/重试更新按钮或 Vite 错误浮层，编译诊断留在终端。

双击打包目录的 `AlphaCode.exe` 使用随包静态资源，不接收源码热更新；`build:web` 也不会覆盖该包内的页面。日常开发请使用 `bun run dev:app`，需要更新打包版时重新执行 `bun run package:app`。Windows 开发启动器只隐藏辅助进程，Electron 主窗口正常显示。

| 修改位置 | 开发时的行为 |
| --- | --- |
| `alphacode-web/src` | Vite HMR + React Fast Refresh；兼容的组件更新保留输入草稿及 React 状态 |
| `alphacode-app/src` | `vite-plugin-electron` 监视构建并自动重启 Electron；共享后端继续运行 |
| App Server / `packages` | 现有 supervisor 检测源码变化，等待生成、审批、队列和保存完成后切换；失败保留原版本并自动退避重试 |

工具链使用已有的 [Vite](https://vite.dev/guide/features.html#hot-module-replacement) / `@vitejs/plugin-react`，桌面开发新增 [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron)（支持 Vite 8）。主进程重启和不兼容的 React 更新仍可能重置页面状态；Vite 整页刷新前会尝试暂存可安全保存的文字草稿，不保存附件或未确认的发送。

浏览器开发使用 `bun run dev:web`，同样自动代理真实 API/SSE。默认仅监听 `127.0.0.1:5173`；端口被占用会明确失败，可用 `bun run dev:app --port 5174` 或 `bun run dev:web --port 5174` 指定其他端口。`--database` 可在两种模式下选择数据库。

共享后端的源码监视范围由首次启动它的目录决定。如果该数据库正在被发行版 sidecar 使用，需要先结束旧服务，或通过 `--database` 选择独立开发库，才能监视仓库中的后端源码；前端 HMR 不受此影响。

构建后的应用目录可以整体移动，不依赖仓库、全局 Bun、Node、Go 或前端开发服务器。
需要完整保留 exe 旁的 DLL、资源和 `resources/runtime`，不能只拷贝 exe。
首次安装 Electron 依赖需要下载 Chromium。

Electron 固定为 45.3.1，Electron Packager 固定为 20.3.0。
包内 Bun 和 ripgrep 使用构建机的二进制，因此必须在目标操作系统和架构上打包。
当前验证 Windows x64；macOS / Linux 尚未实机验证。产物为未签名的应用目录，
暂未配置安装向导、签名、公证和自动更新发布。

## 服务与数据

主进程通过 `alphacode-app-server --ensure` 发现或启动同一数据库的共享服务。
数据库仍按 `--database`、`ALPHACODE_DB`、全局配置和默认路径选择；不迁移历史数据。

```powershell
bun run dev:app --database C:/work/sessions.db
& ".\apps\alphacode-app\dist\AlphaCode-win32-x64\AlphaCode.exe" --database C:/work/sessions.db
```

首次使用仍需通过 CLI `alphacode` 完成项目登记和模型配置。
直接启动桌面应用不会自动读取项目 `.env`；模型配置引用的环境变量应已存在于进程环境，
或由已运行的 CLI 服务持有。退出桌面应用不会杀掉 CLI 共用的服务；服务自行处理空闲退出。

开发模式支持 `ALPHACODE_APP_REPOSITORY` 和 `ALPHACODE_APP_BUN`。发行版使用随包携带的资源。
单实例模式下再次启动会聚焦现有窗口；切换数据库需先退出对应应用。开发窗口使用独立的 `alphacode-app-dev` 偏好目录，可以与已安装的发行版同时运行，避免单实例锁把开发启动转到旧窗口。
发行版主题/语言保存在固定的 `alphacode-app://app` 来源，开发版使用 Vite 的本地来源。发行版桌面偏好保存在系统应用数据目录的 `alphacode-app` 子目录；两者的会话仍存储在所选的共享 App Server 数据库中。

## 桌面边界

```text
Electron BrowserWindow → alphacode-app://app/ → 原 Web 静态资源
                      → /api/* → 主进程 loopback HTTP → Bun App Server
```

- 主界面使用 Chromium。系统标题栏、窗口缩放与位置恢复、编辑菜单、剪贴板和文件选择由 Electron 提供。
- 主进程保持 Node 权限，渲染器关闭 Node 集成并启用沙箱与上下文隔离；没有向页面暴露通用 IPC 或文件系统接口。
- 后端 token 仅存在原生主进程中（开发时由 Vite 启动器代理），不进入 URL、页面存储或日志。只连接校验后的 `127.0.0.1` 服务，不跟随重定向。开发代理检查 Host / Origin 并拒绝跨站请求。
- SSE 持续流式转发，取消阅读会关闭后台连接；不自动重放失败 POST，沿用 Web 的 requestId 重试机制。
- HTTP(S) 外链通过系统浏览器打开；其他外部协议和远程窗口导航被阻止。
- 发行版页面使用包内版本；源码热更新仅在 `dev:app` / `dev:web` 开发服务中启用。

## 验证

```powershell
bun run test:app
bun run --cwd apps/alphacode-app typecheck
bun run --cwd apps/alphacode-app lint

# 已打包应用的真实后端集成验证：临时数据库，执行 /skills，不请求模型
$env:ALPHACODE_APP_TEST_RUNTIME = (Resolve-Path "apps/alphacode-app/dist/AlphaCode-win32-x64/resources/runtime").Path
bun run test:app
```

协议测试覆盖来源/路径校验、凭证隔离、POST 内容、错误状态、重定向拒绝、SSE 实时传输与取消。
发行目录集成验证覆盖服务启动与复用、会话、Skills、Trace 和流式本地命令。
