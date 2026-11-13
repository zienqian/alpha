# AlphaCode 产品图标

当前源图为 `alfi-icon-transparent.png`，只保留 ALFI 二维人物、蓝围巾和深色轮廓，人物外部为透明 alpha，没有底板或背景色。`alfi-app-icon-concept.png` 保留为最初的带底板概念稿。部署资源直接随源码提交，正常开发和打包不需要图像生成服务或额外图像依赖。

| 用途 | 资源 |
| --- | --- |
| 侧栏品牌图标 | `apps/alphacode-web/public/icons/alphacode-{32,64,128}.png`，显示为 28px |
| 浏览器标签 | `apps/alphacode-web/public/favicon.ico` 和 16/32px PNG |
| 移动端书签 | `apps/alphacode-web/public/icons/alphacode-180.png` |
| Windows 窗口、任务栏及 EXE | `apps/alphacode-app/assets/icon.ico`，含 16/24/32/48/64/128/256px |
| macOS 应用包 | `apps/alphacode-app/assets/icon.icns`，含 16–1024px |
| Linux 窗口、macOS Dock | `apps/alphacode-app/assets/icon.png`，512px |
| 终端欢迎页 | `apps/alphacode/src/ui/alfi-image.json`，内嵌 128px PNG；自动选择 Kitty、Sixel 或字符块渲染 |

更换源图后，在 Windows PowerShell 中运行以下命令重新导出。脚本仅缩放和转换格式，保留原稿的比例、配色与透明度；使用系统自带的 System.Drawing，不安装依赖。

```powershell
powershell -NoProfile -File docs/brand/alphacode-icon-v1/export-icons.ps1
```

随后运行 `bun run build:app`；更新发行版时运行 `bun run package:app`。侧栏与网页图标由 Web 构建复制，原生图标由桌面打包脚本同时嵌入和携带。

终端用 `bun run --cwd apps/alphacode build` 构建。PNG 会随 JavaScript 内嵌，切换工作目录或运行构建产物不会丢失资源。空会话在至少 60 列、18 行时显示人物；窄窗口和已有对话保持紧凑品牌栏。`NO_COLOR`、`TERM=dumb` 或图片加载失败时显示纯字符头像。背景透明度由终端图片协议处理；Sixel 对半透明边缘的支持有限。
