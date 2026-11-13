# ALFI 半身表情宠物

正式资源，仅保留头部、肩部和蓝围巾。宠物已加入 ChatGPT Pets，名称为 **ALFI 阿尔菲**；稳定 ID 保存在 `sprite-layout.json`。

| 文件 | 用途 |
| --- | --- |
| [spritesheet.png](spritesheet.png) | 透明精灵图，1536×2288；8×11 格，每格 192×208；73 个有效帧 |
| [sprite-layout.json](sprite-layout.json) | 状态、帧位置、播放时长、16 个视线方向及宠物 ID |
| [four-expressions.gif](four-expressions.gif) | 好奇、专注、完成、休息的并排动画预览 |
| [four-expressions.png](four-expressions.png) | 四种代表表情的静态预览 |
| [all-states.mp4](all-states.mp4) | 九种动画状态的完整演示 |
| [look-directions.gif](look-directions.gif) | 16 个视线方向的循环演示 |

预览图的浅色底用于展示，正式精灵图背景透明。四表情映射：好奇 → `waiting`；专注 → `running`；完成 → `waving` / `review`；休息 → `idle`。

原画使用内置图像工具生成，正式 PNG 已通过 Pets v2 校验。SHA-256：`e0cee49f88d4eddb10fe70287cf06087f2cc8eac35f6aaff52b6a5844db8e239`。
