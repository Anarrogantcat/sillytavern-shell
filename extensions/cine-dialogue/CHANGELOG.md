# 分镜对话 Cine Dialogue · 更新日志

## v0.2.1 (2026-10-13) — 自检修出 3 个缺陷

### 修 ①（严重）：钩子路径会把**正文整段丢掉**
`renderMessageHTML` 原来用**整条原文**做 `hasOurLines` 判据：

```js
if (!hasOurLines(text)) return null;   // ← 用了整条原文
```

若标签**只出现在 `<htmlcontent>` / `[FRONTEND]` 里**，整条原文判为「有我们的行」，
但 `splitSections` 把外壳切走后正文里没有我们的行 → `renderMessage` 返回 `html:null`
→ 继续拼 `'' + 前端 + 选项` 得到**非空字符串** → 钩子的 `!res.html` 拦不住 → **正文消失**。

**改法**：判据改用**切完之后的正文**，并加双保险 `if (!res.html) return null`。

### 修 ②：钩子路径丢失「首行缩进」与「名字列统一」
`run()` 里写了 `if (hookActive()) return;` —— 一退到底，于是 `applyIndent` / `unifyNameColumn`
在钩子路径下**永远不跑**；`refreshAt()` 同样直接 return。

**改法**：抽出 `decorate(mesEl)`（只做这两件「必须看渲染结果才能做」的事），
**两条路径都跑**：钩子路径 → 只补装饰；降级路径 → 渲染 + 装饰。

### 修 ③：夹具把版本号写死 → 每次升版本假红
`scripts/compat-logic-test.mjs` 夹具 78 断言 `const VERSION = '0.33.0'` 字面量，
升到 0.33.1 就失败（本轮实测：658/0 → 657/1）。

**改法**：改成断言「代码里的 `VERSION` == `manifest.json` 的 `version`」且 ≥ 0.33.0 ——
意图不变（版本号真升了、且只有一处来源），但不再随版本漂移，**还能抓到真正的漂移**。

### 夹具
- **73 → 76 条**：新增 3 条**回归对照**（按 AGENTS §1.4.6「旧行为可复现 + 新行为断言同时存在」）
  - 旧行为可复现：`hasOurLines(整条原文) === true`（证明这个坑真实存在）
  - 新行为锁死：`renderMessageHTML(...) === null`（绝不吃掉正文）
  - 正文判据确认为 false

## v0.2.0 (2026-10-13) — 接入核内渲染漏斗钩子：标签永不进 DOM

### 新增：`window.CineDialogueFormat` 钩子路径
配合 `patches/001-messageFormatting-hook.patch`（ST 本体 `public/script.js`）。
装了补丁时 ST 会在 **`messageFormatting()` 开头**调它 —— 那时 markdown / showdown / DOMPurify **都还没跑**。

**解决了 4 件事：**

| # | 问题 | 钩子路径下 |
|---|---|---|
| 1 | **流式期间标签裸奔可见** | 标签**永不进入 DOM**（一次 6000t 生成要几分钟，这是最肉眼可见的缺陷） |
| 2 | 与 card-compat 的时序竞争 | 不存在了（`updateMessageBlock` 会重走 `messageFormatting`） |
| 3 | 「我们的行」和别的内容混在一块 → 整块跳过 | 钩子拿整条原文，可整体处理 |
| 4 | 编辑 / swipe / 重渲染要额外补跑 | 自动正确 |

### 双路径共存（自动降级）
- **打了补丁**：钩子接管；`window.__cdMessageFormattingHook = true` → DOM 后处理**自动停用**（`run()` / `refreshAt()` 早退）
- **没打补丁**：`window.CineDialogueFormat` 无人调用，自动走原来的 DOM 后处理
- **两条路共用同一个 `logic.js`** —— 渲染逻辑只有一份

### `logic.js` 新增
- `renderMessageHTML(raw, colors, config)` —— 钩子路径入口，返回**整条消息**的 HTML
  （钩子不能改 DOM，所以前端区要自己原样拼回；选项区渲染成按钮）
- `splitSections` **同时认两种外壳形式**：
  - `[FRONTEND]…[/FRONTEND]` / `[OPTIONS]…[/OPTIONS]` —— 我们正则换出来的（DOM 路径看到）
  - `<htmlcontent>…</htmlcontent>` / `<options>…</options>` —— 预设原始输出（**钩子路径看到**，因为钩子在正则之前跑）
- `RE_OPT_ALT` —— 认预设 `<options>` 里的 `>选项一：…` 写法

### 夹具
- **60 → 73 条**（新增 13 条：双形式外壳、`>选项一：`、`renderMessageHTML` 的 null 分支/前端原样/选项渲染/标签不出现）

### 安全
- 钩子里**任何异常都原样返回原文**（`catch { return mes }`）—— 绝不把消息弄坏
- `ctx.isSystem` / `ctx.isUser && !transformUserMessages` 直接放行

## v0.1.0 (2026-10-13) — 首次发布：核心渲染（L1）

### 新增
- `logic.js` 纯逻辑层（不碰 DOM / ST，可在 Node 里跑夹具）
  - 契约解析：`名字·层 内容`（层后**强制一个空格**）/ `旁白·内容` / `[FRONTEND]` / `[OPTIONS]`
  - 五层：台词 / 动作 / 感官 / 心理 / 旁白
  - **颜色 = 角色**：按出现顺序分配，超出 8 色走黄金角 HSL；给 seed 则稳定不变
  - **一条消息一个网格** → 名字列宽整条统一
  - 格式错的行 **显式标红**（不静默降级成旁白）
- `style.css`：全部选择器 `cd-` 前缀，**不含任何全局选择器**（AGENTS §0.3.2）
  - 动作实线 3px / 感官点线 3px / **心理双线 3px + 斜体** / 台词无标记 / 旁白灰
  - 亮色主题由 `.cd-light` 类切换（不选 `:root`）
  - 窄屏媒体查询（选择器仍限 `cd-`）
- `index.js` 挂载层
  - **8 个触发点**：`CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` / `GENERATION_ENDED` /
    `MESSAGE_UPDATED` / `MESSAGE_EDITED` / `MESSAGE_SWIPED` / `CHAT_CHANGED` / `MORE_MESSAGES_LOADED`
  - **流式安全**：流式中 `.mes_text` 被逐 token 重写 → 不处理，等 `GENERATION_ENDED`
  - **幂等**：每次都从 `chat[mesid].mes` 原文重算，不缓存 DOM
  - **只替换「100% 是我们的行」的 DOM 块**；其余节点（前端 iframe / 思考块 / 状态栏）原样保留
  - 整楼名字列宽统一（多个块时量取最大后固定）
  - 首行缩进只给「真的换行」的段落；**台词永不缩进**
- 适配层（探测 + 降级，不硬依赖）
  - **酒馆助手** `TavernHelper.getChatMessages` 取原文 → 无则退回 `getContext().chat[id].mes`
  - **MVU** `Mvu` 探测（本版只报状态，阶段 7 才读 `stat_data`）
  - **卡兼容助手** `CardCompat`（0.33.0）：只读 `version/protocol/compatMode/mvu`；不改它
- 对外 API：`CineDialogue.config / setConfig / colors / refreshAll / render / stats`
- `loading_order: 110` —— 排在 酒馆助手(100) / card-compat(30) / plot-pilot(40) **之后**

### 与 card-compat 的时序适配（实测依据）
- 它 `GENERATION_ENDED` 后有 **2500ms / 7000ms** 延迟动作、`CHARACTER_MESSAGE_RENDERED` 后有 **1500ms** `checkFrontBlocks`
- 这些动作若重渲染会冲掉我们的 DOM → 我们在生成结束后 **补跑 200 / 1600 / 2700 / 7300 ms** 四次

### 已知限制（下一阶段处理）
- `[FRONTEND]` 段落目前**原样保留**（不重排），若前端不在消息末尾，顺序不会被调整
- 一个块里**混着**我们的行和别的内容（如行内 `<tucao>`）时，**整块跳过**（宁可不渲染，不破坏别人的 HTML）
- 设置面板 / 逐卡配置 / 卡内嵌脚本沙箱 / 选项发送通道 → 见方案的 L2 / L5 / L6 / L8
