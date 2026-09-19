# 酒馆助手脚本（JS-Slash-Runner）— 通用版

> ⚠ **本目录的「继续按钮」已被 ST 扩展取代（2026-09-20）**：请优先使用 `extensions/plot-pilot/`（剧情推进器 Plot Pilot），
> 它把配置搬进了 ST 设置、支持每卡覆盖、api/dom 双发送通道与旧脚本冲突保护。
> 安装：`node scripts/ext-install.mjs plot-pilot`。本目录脚本仅作回滚备份，两边不要同时启用。

## continue-button-all-cards.js（旧版，建议停用）

原来那份「继续按钮」是**某张角色卡自带**的（里面的 `blueprint_controller` 就是那张卡的变量），拖到全局后：
- 「▶ 继续」能用（文案通用）；
- 「▶ 推进剧本步骤」在**没有剧本系统的卡上**会发一句模型看不懂的指令（`请根据当前blueprint_controller…`）。

**通用版做了三件事**：

| 改动 | 说明 |
|---|---|
| **自动探测剧本系统** | 扫描当前卡的世界书 + 字段 + 扩展脚本，找 `blueprint_controller / blueprint / 剧本控制器 / 推进至下一个 step` 等关键字；探测到真实变量名就用它填进文案 |
| **按卡显示/隐藏按钮** | 有剧本系统 → 显示「▶ 推进剧本步骤」；没有 → 默认隐藏（可用 `showAdvanceWhenUnknown: true` 强制显示，此时用通用文案「（推进到下一个剧情节点）」） |
| **发送更稳 + 更省性能** | 发送前等发送按钮可用（生成中会被禁用，最多等 2 秒）、防连点；DOM 监听改为**节流**（默认 300ms）并只在按钮缺失时注入 |

### 实测覆盖（本机 93 张卡）

```
有剧本系统 = 22 张   → 显示两个按钮（并用卡里真实变量名）
无剧本系统 = 71 张   → 只显示「▶ 继续」
```

### 安装

1. 酒馆助手 → **脚本** → 新建脚本 → 把 `continue-button-all-cards.js` 全文粘进去 → 保存并启用；
2. **停用/删除原来那份「继续按钮」脚本**（否则两个脚本会各注入一套按钮）；
3. 刷新页面。

### 配置（控制台执行，自动存 localStorage）

```js
YDContinue.cfg                                   // 查看当前配置
YDContinue.setConfig({ continueText: '（继续）' }) // 改「继续」的发送文案
YDContinue.setConfig({ showAdvanceWhenUnknown: true }) // 没有剧本系统的卡也显示推进按钮
YDContinue.setConfig({ advanceText: '请根据当前 {var} 推进到下一步' }) // {var} 会替换成检测到的变量名
YDContinue.recheck()                             // 重新探测当前卡并重注入按钮
```

### 边界

- 依赖酒馆助手提供的 `SillyTavern.getContext()`；没装酒馆助手时脚本不生效（不会报错刷屏）。
- 探测是**关键字启发式**：卡里只要有 `blueprint` 字样就算"有剧本系统"；误判时用 `showAdvanceWhenUnknown` / `setConfig` 手动兜。
