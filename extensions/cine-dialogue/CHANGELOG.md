# 分镜对话 Cine Dialogue · 更新日志

## v0.5.1 (2026-10-13) — 真凶：模块链接失败（0.1.0 起一行代码都没执行过）

### 根因（这才是「总览里看不到 / 刷新了没反应」的真原因）
- **`extension_settings` 不是 `script.js` 的导出** —— 它由 `scripts/extensions.js` 导出
- 我们写成了 `import { …, extension_settings } from '../../../../script.js'`
- ES module 只要有一个导出名不存在 → **整个模块链接失败 → 一行都不执行**
- 表现极具迷惑性：扩展在「管理扩展程序」里显示**已启用**（那是 **manifest** 层面，不代表代码跑过），
  但抽屉 / 渲染 / 设置**全都没有**，且除了 console 一条 module error 之外**没有任何提示**
- **对照**：所有能正常工作的扩展 —— card-compat / plot-pilot / hide / LittleWhiteBox /
  st-immersive-sound / st-persona-weaver —— **全部**从 `'../../../extensions.js'` 拿 `extension_settings`。
  **只有我们写错了**

### 修法
- `extension_settings` 改到 `from '../../../extensions.js'`（和 `getContext` 一起），并在代码里写了注释说明为什么

### ★ 新增守卫夹具（全套里最重要的一条）
- **「模块链接自检」**：解析 `index.js` 的每一条 import，逐个名字去 ST 本体的真实导出集合里核对
  （`public/script.js` / `public/scripts/extensions.js`，支持 `export const/function/class` 与**跨多行**的 `export { … }` 块）
- **名字不存在就红**
- 本机找不到 ST 本体时**自动跳过**（不在别的机器上假红）
- 另加一条「确实检查到了 import（不是空跑）」—— 防止哪天正则失效、守卫变成永远绿的摆设

### 为什么早先没发现（我的定位失误，记下来）
- 我用「和 card-compat / plot-pilot 对比」验证过 —— 但**只对了路径层级，没核对导出名**
- 又因为「文件在正确目录 + manifest 合法 + 无 BOM + import 路径层级对」就判了「交付没问题」
- ⇒ 教训：**「文件放对了」≠「代码跑起来了」**。能静态验的东西（导出名是否存在）必须静态验

### 说明
- 只改扩展 + 夹具 → 不升套壳版本号、不打 tag、不发包（AGENTS §1.1）
- 核内补丁 #001 未改动（仍已应用）

## v0.5.0 (2026-10-13) — L2 交互 + L5 数据 + L6 面板 + L7 导出 + L8 生态（补完）

### L5 数据层
- **逐卡配置**：`perCard[卡文件名]` + 面板「存为这张卡的专属配置 / 清除」。渲染路径全部改走 `effectiveConfig()`（全局 + 本卡覆盖）
- **导出 / 导入**：`serializeConfig` / `parseConfig` —— **白名单键 + 逐项类型校验**，未知键与类型不符的键丢进 `dropped` **并报告**，不静默接受脏数据
- **批量渲染上限** `maxRenderFloors`（0 = 不限）；只影响 DOM 降级路径（装了核内钩子时 ST 自己按窗口渲染）
- **MVU 只读**：`CineDialogue.mvu()` —— **绝不写**（写数据是 card-compat 的职责，AGENTS §0.3.1）

### L2 交互层
- **只看某角色**：其余行 `.cd-dim` 变淡（hover 恢复），旁白不受影响
- **搜索高亮**：`highlightPlan`（纯函数）+ DOM 后处理 —— 改一个词不该重算全部楼层
- **双击复制该行**；**Alt+↑ / Alt+↓** 跳上一/下一有分镜的楼层
  - ★ 为什么不用 hover 复制按钮：按钮一旦放进 `.cd-body` 就会**污染 `textContent`** —— 复制到的文本、搜索高亮重建的文本都会带上它。双击没有这个副作用，提示放 `title`
- **格式错误面板**：**按需扫描**（不维护状态 → 不可能和渲染脱节），列出楼层号 + 原文 + 一点跳过去

### L6 UI 层
- **配色管理**：见过的角色 → 取色器；改一下就**钉死**（写进 `charColors`），「重置」回到按出现顺序分配
- **层样式编辑器**：逐层选左侧标记（无 / 实线 / 点线 / 双线 / 虚线）+ 斜体
  - CSS 改成**变量驱动**（`--cd-mark` / `--cd-mark-color` / `--cd-italic`），静态值只是默认
- **自定义层**：输入层名 → 校验（≤6 字、不含空格与 `·`、不与内置重名）→ 解析器**立刻**认它

### L7 服务端层 —— **不用动本体就做到了**
- **导出全部分镜为 Markdown**（Blob 下载，纯浏览器，不碰服务器）
- 结论：这一层原计划要动本体，**实测不需要**；`/api/...` 与 Blob 已经够用

### L8 生态层
- 新增 API：`detect(text)` / `registerLayer({name,mark,italic})` / `errors(n)` / `exportStory()` / `effectiveConfig` / `cardKey()` / `mvu()`
- **`eventSource.emit('cine:rendered', {...})`** —— 别的扩展可 `eventSource.on('cine:rendered', fn)` 接

### 夹具：109 → 150 条
- ★ **回归**：**`layerVars` 永不输出 `--cd-mark:none`** —— `border-style:none` 会让 used border-width 归零，那一行整体左移 3px（早先在预览原型里踩过这个坑，现在锁死）
- ★ **配置面覆盖度断言**：每个 `DEFAULT_CONFIG` 键要么有面板字段、要么登记为代码管理
  → **本轮抓出 4 个**：`promptPosition` / `maxRenderFloors` / `copyOnClick` 漏了 UI；`lazyRender` 是**从没实现的死配置** → 删掉
- ★ **`resolveColors` 真 bug**：钉死一个角色的颜色会把**别人**挤后一位 → 改成「取还没被占用的调色板颜色」，钉死不影响他人
- 新增：自定义层解析 / 层名校验 / 高亮切段与拼回 / 大纲截断 / 导出导入往返 / schema 与类型拒绝 / 数值型 select 转数字
- 修 **2 条过时断言**（旁白行现在带 `style` 与 `title`，正则加 `[^>]*`）

### 说明
- 只改扩展 + 夹具 → 不升套壳版本号、不打 tag、不发包（AGENTS §1.1）
- 核内补丁 #001 未改动（仍已应用）

## v0.4.0 (2026-10-13) — L3 提示词注入 + L4 斜杠命令 + 专属正则（4 条）

### 新增：L3 提示词层 —— **不再依赖任何一个预设**
- `FORMAT_SPEC`：格式说明的**唯一权威文本**（放 `logic.js`，不是散落在提示词里）
- `applyPromptInjection()`：用 `setExtensionPrompt()` 注入（位置 / 深度可调），`CHAT_CHANGED` 时重新注入
- **默认关**（`injectPrompt: false`）：专属预设 `Izumi 0828.tailfree + 分镜` 里已有同样说明，
  两边同时开会**重复占提示词**；换回原版预设时打开它 —— 这样插件对预设**零依赖**

### 新增：L4 生成层 —— 斜杠命令
- `/cine`（别名 `/cd`、`/storyboard`），子命令：`refresh` / `stats` / `config` / `regex`
- 形状照已装扩展 **RUBY** 的范例：ST 通过 `getContext()` 暴露
  `SlashCommandParser` / `SlashCommand` / `SlashCommandArgument` / `ARGUMENT_TYPE`
- API 不可用时**只 console.warn，不影响渲染**（降级，不崩）

### 新增：专属正则 4 条
- `REGEX_DEFS`（纯数据）：
  | # | 名称 | 默认 |
  |---|---|---|
  | R1 | 去掉 `<content>` 包裹 | 关（可选） |
  | **R2** | 前端区包成 `[FRONTEND]` | **开** |
  | **R3** | 选项区包成 `[OPTIONS]` | **开** |
  | R4 | 压缩连续空行 | 关（可选） |
- 全部**只改 `destination.display`、不碰 `prompt`**，`max_depth: 3`（只作用最近 3 楼）
- **一次写完**：`updateTavernRegexesWith` 会重载整个聊天，分多次写会卡好几轮 → 所以合成一次调用
- 面板按钮「安装/更新专属正则」「移除专属正则」；**只删自己的**（按 `script_name` + `cd-r` id 前缀）
- ★ 但请注意：**渲染漏斗钩子路径本来就能同时认 `[FRONTEND]`/`<htmlcontent>` 两种外壳**（见 `splitSections`），
  所以 R2/R3 只在「没打核内补丁、走 DOM 后处理」那条**降级路径**上必需

### 夹具：83 → 109 条
- **L3**：说明够长 / 含五层名 / 写明「层名后必须有空格」与「第一人称」/ 禁止自创层名 /
  **说明里的示例行必须能被自己的解析器解析**（不然等于教模型输出我们解析不了的东西）
- **正则**：4 条 · id 与名字唯一 · 名字都带 `【分镜】` · **每条 `find_regex` 都能编译** ·
  只改 display · 都有 `max_depth` · R2/R3 默认开 · R2/R3 真能匹配到 `<htmlcontent>`/`<options>`
- ★ **闭环断言**：把 R2+R3 真跑一遍，之后的文本 `splitSections` **必须**认得出前端区与选项 ——
  **正则与解析器不许脱节**（这是最容易两边各改一半、谁都不知道的地方）
- **斜杠命令**：有名字 / 别名 / helpString / 子命令 ≥3 且唯一 / `refresh·stats·config·regex` 齐全

### 说明
- 只改扩展 + 夹具 → 不升套壳版本号、不打 tag、不发包（AGENTS §1.1）
- 核内补丁 #001 未改动（仍已应用）

## v0.3.0 (2026-10-13) — 设置面板抽屉（顺带解开「总览里看不到」）

### 新增：设置面板（计划的 L6）
- **为什么必须有这个抽屉**：ST 的「扩展程序」总览**不是**「已加载扩展清单」，
  而是各扩展**自己**往 `#extensions_settings` / `#extensions_settings2` append 的 `inline-drawer`。
  **实测对照**：card-compat 3 处 append、plot-pilot 3 处、hide 6 处 → 它们出现在总览里；
  本扩展 **0 处** → 只在「管理扩展程序」页可见、总览看不到。
  ⇒ **没有抽屉 ≠ 没加载**（用户实测已确认：管理页里 `分镜对话 (Cine Dialogue) 0.2.1` 已勾选启用）
- 抽屉内容：启用 / 也渲染用户消息 / 只给换行段落缩进 / 格式错行标红 /
  名字列宽（自动·固定 + 像素）/ 行间距 / 首行缩进
- 按钮：**「立即重渲染全部」**、**「诊断信息」**（输出 stats：核内钩子接线状态、渲染计数、TavernHelper/MVU/CardCompat/PlotPilot 探测结果）
- 改动任一开关 → `saveSettingsDebounced()` + 立即全量重渲染

### 设计
- **字段定义放纯函数层**（`logic.js` 的 `PANEL_FIELDS`）：面板 HTML 在 `index.js`（碰 DOM，Node 里测不了），
  但字段表可以夹具断言 —— 挡住「拼错 key → 改了没反应」这类静默失效
- **CSS 只写 `#cd-panel` 里的自有元素**：抽屉骨架 `.inline-drawer` / `.menu_button` 是 **ST 自己的类**，
  一律不覆写 —— 覆写会漏进别的扩展的设置面板（AGENTS §0.3.2）

### 夹具
- 76 → **83 条**：新增 7 条面板字段断言（key 必须真实存在于 `DEFAULT_CONFIG` / 不重复 / 类型合法 /
  select 必须带 options / number 必须带 min·max·step / 默认值不得越界）
- 全量：compat-logic **658/0** · plot-pilot **67/67** · cine-dialogue **83/83** · ext-manage **49/49**
- **选择器白名单检查**：35 个选择器**全部**在 `#cd-panel` / `.cd-` 内 ✓

### 说明
- 只改扩展 + 夹具 → 不升套壳版本号、不打 tag、不发包（AGENTS §1.1）
- 核内补丁 #001 未改动（仍已应用）

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
