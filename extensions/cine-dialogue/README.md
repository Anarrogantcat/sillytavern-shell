# 分镜对话 Cine Dialogue

把「`名字·层 内容`」这种行渲染成**分镜式对话** —— 颜色=角色、样式=层、标签永不出现、长段落可读。

配合 `Izumi 0828.tailfree + 分镜.json` 预设使用（该预设已把行格式写进提示词）。

## 契约（插件只认这些）

| 输入（模型原文） | 插件行为 |
|---|---|
| `名字·层 内容`（层 = 台词/动作/感官/心理） | 渲染成分镜行 |
| `旁白·内容` | 旁白行（无名字格，内容灰） |
| `[FRONTEND] … [/FRONTEND]` | **整段跳过，一个字节不碰** |
| `[OPTIONS] … [/OPTIONS]` | 解析成选项按钮 |
| **其它任何内容** | **原样保留** |

**层名后必须有一个空格**；写漏了会**显式标红**（不静默降级成旁白）。

## 样式

| 层 | 左竖线 | 字体 |
|---|---|---|
| 动作 | 实线 3px | 正体 |
| 感官 | 点线 3px | 正体 |
| 心理 | **双线 3px** | **斜体** |
| 台词 | 无 | 正体（带「」） |
| 旁白 | 无 | 正体（灰色、无名字） |

颜色 = 角色，按出现顺序分配（超出 8 色走黄金角 HSL）。

## 排版

- **一条消息一个网格** → 名字列宽按整条消息最长名字算（不是每段各算）
- **行间距用 `row-gap`** —— `.cd-row` 是 `display:contents`，`margin` 无效
- **所有行 border 宽度一致**，只换颜色/样式；否则有线行被推偏
- **首行缩进只给真的换行的段落**；台词永不缩进

## 安装 / 更新

```powershell
# 仓库根目录
node scripts/ext-index.mjs             # 重建 extensions/index.json
node scripts/ext-install.mjs           # 下发到 ST 数据目录
node scripts/ext-index.mjs --check     # 必须 exit 0
node scripts/cine-dialogue-test.mjs    # 夹具
```

落到 `D:\AI\SillyTavern\Data\default-user\extensions\cine-dialogue\`，刷新 ST 页面生效。

## 事件挂载（8 个）

`CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` / **`GENERATION_ENDED`**（流式收尾）/
`MESSAGE_UPDATED` / `MESSAGE_EDITED` / `MESSAGE_SWIPED` / `CHAT_CHANGED` / `MORE_MESSAGES_LOADED`

**流式中不处理** —— 流式时 `.mes_text` 被逐 token 重写，等 `GENERATION_ENDED` 再处理一次。

## 幂等

**每次都从 `chat[mesid].mes`（模型原文）重算**，不缓存、不依赖上一次的 DOM。
所以重跑多少次结果都一样。

## 对外 API

```js
CineDialogue.version
CineDialogue.config                 // 配置快照（只读）
CineDialogue.setConfig({ rowGap: 1.2 })
CineDialogue.colors                 // 每楼的颜色表
CineDialogue.refreshAll()           // 全量重渲染
CineDialogue.render(text, colors)   // 纯函数：文本 → 分镜 HTML（不碰 DOM）
CineDialogue.stats()                // 心跳：loadedAt / runs / TavernHelper / Mvu / light
```

## 适配（探测 + 降级，不硬依赖）

| 依赖 | 用它的什么 | 没有时 |
|---|---|---|
| **酒馆助手** `TavernHelper` | `getChatMessages` 取原文 | 退回 `getContext().chat[id].mes` |
| **MVU** `Mvu` | 只读 `stat_data`（阶段 7 才用） | 跳过 |

## 边界（硬规则）

- **不改别的扩展** —— 只调它们的公开 API
- **不覆写卡的状态栏外观** —— `[FRONTEND]` 段整段跳过，一个字节不动
- **CSS 只用自己的 `cd-` 前缀** —— 不出现 `.mes_text` / `.mes` / `body` / `html` / `:root`
- ST 本体改动走 `AGENTS.md` §0.5 例外登记（可重放补丁集）

## 卸载

删除 `Data\default-user\extensions\cine-dialogue\` 即完全复原（外加 `extension_settings["cine-dialogue"]` 一条配置）。
