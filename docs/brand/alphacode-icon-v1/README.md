# AlphaCode 产品图标

已确认的源图为 `alfi-app-icon-concept.png`，沿用 ALFI 二维专注表情。部署资源直接随源码提交，正常开发和打包不需要图像生成服务或额外图像依赖。

| 用途 | 资源 |
| --- | --- |
| 侧栏品牌图标 | `apps/alphacode-web/public/icons/alphacode-{32,64,128}.png`，显示为 28px |
| 浏览器标签 | `apps/alphacode-web/public/favicon.ico` 和 16/32px PNG |
| 移动端书签 | `apps/alphacode-web/public/icons/alphacode-180.png` |
| Windows 窗口、任务栏及 EXE | `apps/alphacode-app/assets/icon.ico`，含 16/24/32/48/64/128/256px |
| macOS 应用包 | `apps/alphacode-app/assets/icon.icns`，含 16–1024px |
| Linux 窗口、macOS Dock | `apps/alphacode-app/assets/icon.png`，512px |

更换源图后，在 Windows PowerShell 中运行以下命令重新导出。脚本仅缩放和转换格式，保留原稿的比例、配色与透明度；使用系统自带的 System.Drawing，不安装依赖。

```powershell
powershell -NoProfile -File docs/brand/alphacode-icon-v1/export-icons.ps1
```

随后运行 `bun run build:app`；更新发行版时运行 `bun run package:app`。侧栏与网页图标由 Web 构建复制，原生图标由桌面打包脚本同时嵌入和携带。
