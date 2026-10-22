# 分镜对话 Cine Dialogue · 更新日志

## v1.9.7 (2026-10-22) — 修：没有卡前端的卡也要画选项按钮 + 夹具口径修正

**用户**：「没有生效」——选项仍是纯文本、点不动（1.9.6 只放行了带前端标记的楼，没动真正的门控）。
**真正的门控**：`logic.js` 的 `keepOptions = !!cfg.respectCardFrontend`；用户 respectCardFrontend=true（默认）
⇒ `<options>` 一律留在正文。而 人妻牛 实测 `cardHasFrontend=false`（JK/灯火幽微/欲妈群 才是 true）
⇒ 卡不画、插件也不画 ⇒ 谁都画不出来 ✗。
**修法**：`keepOptions = respectCardFrontend && cardHasFrontend` —— 只有真有前端的卡才让位；
没有卡前端时选项栏由插件提供 ✓（= 1.8.3 之前 DOM 路径的表现，即用户说的「以前正常」）。
**夹具口径修正（两处）**：`<details>`（折叠的思考块/事件块）里的文字**不算可见文字** ——
模型在思考里写「名字·动作/感官/… 格式」这类说明，旧口径会算成标签裸露 ⇒ 误报 ✗。
**注意**：ST 默认 `cacheBuster: false`，验证必须**硬刷新**（Ctrl+F5）。

## v1.9.6 (2026-10-14) — 修：带卡前端的楼放行给 DOM 路径（选项栏/状态栏被钩子路径重建吃掉）

**症状**（用户）：「选择没有状态栏美化也点击不了」，以前正常。
**根因（代码级）**：1.9.4 让官方钩子路径也置接线标记 ⇒ 扩展从 **DOM 路径**切到**钩子路径**；
钩子跑在 `messageFormatting` 开头、必须**重建整条消息 HTML**（`logic.js:1106-1107` 注释自己写着
「不能再依赖保留原 DOM 节点」），而 `respectCardFrontend=true` 时 `<options>` 只是留在正文里
（`logic.js:1118/1141`）⇒ 卡脚本画出来的选项栏/状态栏节点**全丢** ✗（真机：同一条楼 `.cd-opt`=0、纯文本）。
**改动**：`index.js` 新增 `CD_FE_MARKER`（`StatusPlaceHolderImpl|<option/>|<options>|<StatusBar>|UpdateVariable|TavernHelper|stat_data|<%`）
⇒ 命中标记的楼在钩子里**记录 mesid 后原样放行**，并由渲染循环让这些楼**照旧走 DOM 路径**
（DOM 路径把非我们的节点原样保留 ⇒ 卡的 UI 回来 ✓）。
**状态（未定）**：本版**尚未获得真机确认**（用户收工前未复验）；夹具 `G3 标签裸露 1` 已定性为
**数据误报**（`人妻牛` 新聊天**思考块内文**里写着「名字·动作/感官/…格式」，夹具取可见文字时把折叠块也算进去了），
与本次改动无关 ✓。

## v1.9.4 (2026-10-14) — 撤核内补丁后：接线标记改由官方钩子路径设置（真机验证）

**背景**：真机验证「撤掉核内补丁 #001 + 硬刷新」→ 渲染照常（昆仑群芳录 rows=62、标签泄漏 0、零异常），
官方 `MessageFormatter` 确实接管。但实测发现 `window.__cdMessageFormattingHook` **只有核内补丁会设**，
撤掉后它恒为 false ⇒ 扩展会**悄悄退化到 DOM 后处理兜底路径**（结果对，但不是设计的主路径）。

**改动**：官方钩子挂上时（`__cdMsgHookAdded = true` 那一处）同时置 `window.__cdMessageFormattingHook = true`。
**验证**：撤补丁状态下手动置标记 + 强制重渲染 ⇒ 钩子路径 `rows=62 / leak=0`，与兜底路径结构一致 ✓。
**配套**：`st-compat-check.mjs` / `cine-selfcheck.mjs` 的补丁口径改为「未应用 = 合规（1.9.2 起官方接管）；
若应用了则必须与 patch 逐字节一致」，消除假警报。夹具 801/0。

## v1.9.3 (2026-10-14) — 「通用版」预设补上思维链 / Progress 正则（真机验证发现）

**真机证据**（自有 Edge + CDP 驱动 ST 1.19.0）：通用版预设下，思考链与旧 Progress **全部裸露** ——
9 层里 4 层带裸 `<konatan_planning~>…</konatan_planning~>`，`wrap=0 / leak=4 / prog=4`。

**根因（对照实验）**：干净版底稿是 ST 官方 `Default.json` ⇒ `extensions.regex_scripts` = **0 条**；
而所有工作正常的预设都带 9~16 条启用（`Izumi 0828.tailfree` 27/9 · `专属适配 v1.9.2` 27/10 · `Izumi_0914` 30/16）。
⇒ 不是插件坏了，是**通用版没把那一套正则带上**。

**改动**
- `scripts/cine-preset.mjs`：干净版构建时，从素材预设（默认 `Izumi 0828.tailfree.json`）**搬入 `regex_scripts`** ——
  只补缺的、保持原启用状态；正则本体来自用户本机那份原预设，**不进仓库**（许可：可以二改、禁止二传）。
- 位置在 `applyPresetRecipe` **之前** ⇒ 配方第 ④ 步同时生效：思维链正则 `maxDepth` 2 → **20**。
- `VERSION` 1.9.2 → 1.9.3（`logic.js` / `manifest.json` / 夹具预期三处同步）。

**结果**：`分镜对话（通用版）v1.9.3.json` = `regex_scripts` **26 条 / 启用 9 条**，含
`1美化最近二层思维链(流式夜间)-修复换行`（maxDepth=20）· `9只保留Progress(11楼后)` ·
`10隐藏近期旧Progress(4-10楼)` · `12美化事件（夜间-护眼版）`。

**夹具**：`cine-full-test` 801/0 · `st-compat-check` 0 项 · `cine-selfcheck` 0 项。

## 未发版 · 决定记录（2026-10-14，纯文档，不升版本号）

**核内补丁 #001 的去留** —— 我按项目规则「改本体必须问」提问，你的选择是：

> **先留着，等新会话浏览器验证后再撤** ✓

执行口径 ✓：
- 本体现状**保持不动**（补丁继续在位 ✓）⇒ 与 1.9.2 的官方 `MessageFormatter` **双路径并存** ✓
- 两条路同时生效**不会重复转换** ✓（`formatHook` 幂等：已转换的文本认不出分镜行 ⇒ 原样返回 ✓）
- 等**浏览器会话**能验证后（新会话才会有 `browser_*` 工具 ✓），在真机上确认官方钩子确实接管 ✓
  ⇒ 再执行 `git -C "D:\AI\SillyTavern\SillyTavern" checkout -- public/script.js` 撤掉补丁 ✓
  ⇒ `patches/001-messageFormatting-hook.patch` **留在仓库里**（随时可重新应用 ✓）

## v1.9.2 (2026-10-14) — 本体更新到 **1.19.0** 的适配（并发现官方有了正式的格式钩子 ✓）

用户：「更新本体了，检查插件有没有失效…三个插件都进行检查」+ 给了 1.19.0 的 release 链接 ✓

**本体兼容性检查结论（三个插件一起查）** ✓：
```
① manifest.json 三个插件都有 ✓ —— 1.19 起「无 manifest 的扩展目录不再被发现」
   （card-compat 0.33.1 / cine-dialogue / plot-pilot 0.2.2 ✓）⇒ 不受影响 ✓
② ESM 链接：三个插件从本体 import 的名字**全部还在** ✓（1.18→1.19 只"挪"了 deleteMessage，没有真删）
③ 事件：引用的 event_types 全部还在 ✓（event_types 定义在 public/scripts/events.js）
④ DOM id：三个插件引用的本体 id 全部还在 ✓
⑤ messageFormatting 签名 1.18 = 1.19 逐字一致 ✓ ⇒ 补丁 #001 仍安全 ✓
⑥ STREAM_TOKEN_RECEIVED 仍 emit（script.js:3919）· messageTextDom.innerHTML 仍写（3752）
   ⇒ 1.9.0 的"流式边出边排版"安全 ✓
⑦ 三个插件各自的夹具全绿 ✓（cine 796/0 · card-compat ✓ · plot-pilot 67/67）
```

**★ 最大发现：1.19 加了官方 `MessageFormatter`** ✓（release notes 的 Extensions 段第一条）：
> Added `MessageFormatter`, allowing extensions to transform message content
> before regex processing, after regex processing, or after Markdown conversion.

它正是我们**核内补丁 #001** 干的事（在 regex / markdown / DOMPurify **之前**改文本 ✓）
⇒ **本版改用官方 API** ✓：
· `getContext().messageFormatter.addHook(fn, { stage: BEFORE_REGEX, order: LATE })` ✓
· 同时设 `window.__cdMessageFormattingHook = true`（与补丁**同一个接线标记** ✓）
  ⇒ `hookActive()` 为真 ⇒ 走同一条"标签永不进 DOM"的主路径 ✓
· 幂等 + 出错原样返回（永不吞消息 ✓）
⇒ **于是核内补丁变成可选**：打了照常工作（formatHook 幂等 ✓），不打也能拿到完整体验 ✓
   （补丁是否撤掉见当轮汇报的"未决"✓ 属于 §二 #2 改本体，需要你拍板 ✓）

**顺带**：自检发现 `respectCardFrontend` / `autoOffCardFrontend` **以前没有面板 UI** ✗
⇒ 本版补上两个勾选框（「卡自带的选项块原样保留」/「带前端的卡自动让位」✓）

**新增两个可复用的检查脚本** ✓（以后每次本体更新都能一条命令跑完）：
```
node scripts/st-compat-check.mjs   # 本体更新后的兼容性检查（三个扩展一起）
node scripts/cine-selfcheck.mjs    # 全面自检（版本/清单/已装/三套测试/本体补丁/发包闸门/开关/正则）
```
说明：只改扩展 + 脚本 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）
## v1.9.1 (2026-10-14) — 修 1.8.4 弄坏的按钮布局（**回退**挂载优先级）

用户截图：按钮被**撑大、压到输入框上** ✗ —— 是我 1.8.4 把按钮塞进 ST 官方
`#rightSendForm` 造成的 ✓（官方栏是紧凑横排，我们的按钮在那儿很难不打架 ✗）。

**本版** ✓：
```
挂载优先级改回（= 之前一直正常的那个）：
  ① #cc-var-bar   （card-compat 的扩展按钮栏 ✓ 本来就是给扩展按钮用的）
  ② 自建 #cd-bar   （没装 card-compat 时，挂进 #send_form）
  ③ #rightSendForm（ST 原生位）**只在①②都不存在时**兜底 ✓
```
并把原生版尺寸**钉死** ✓（`font-size: 11px` / `height: 20px` / `max-height: 26px` /
`flex: 0 0 auto` / `nowrap` / `overflow: hidden` / `position: static`）
⇒ 即便走到兜底路径，也**不可能再撑大或压住输入框** ✓

**教训**（记下来）：1.8.4 我想"不依赖别的扩展的 DOM"，动机没错 ✗ 但**没先看官方栏的布局约束**
就换位置 ⇒ 直接弄坏用户的界面 ✗。以后动**可见布局**，先按"最小改动 + 可一键回退"来 ✓。
夹具 796 / 0（把 1.8.4 那两条断言改回，并新增"原生只是兜底"+"尺寸钉死"两条 ✓）。
说明：只改扩展 + 脚本 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）
## v1.9.0 (2026-10-14) — **流式边出边排版**（可开关 ✓ 扩展层实现，未动本体 ✓）

用户：「让流式输出边出边排版 做，但设置成可开关的」✓

**先说结论：这件事不用动本体** ✓（按 AGENTS §0.5 第 1 条：扩展层能做到就不动本体 ✓）
依据（读本体源码得到的事实 ✓）：
```
public/script.js:3693   this.messageTextDom.innerHTML = formattedText;   ← ST 每 tick 都会重写
public/script.js:3860   eventSource.emit(event_types.STREAM_TOKEN_RECEIVED, text);
public/script.js:3861   await sw.tick(… onProgressStreaming(this.messageId, this.continueMessage + text))
```
⇒ ST 写完**我们紧接着再写一次**就够了 ✓ 不需要改 ST 的任何文件 ✓

**实现** ✓：
· 在**内存里那个实例**外面包一层（`streamingProcessor.onProgressStreaming`）✓
  —— 不改文件、不动本体 ⇒ **ST 更新也不会因此报废** ✓
  ST 每轮生成都会 `new StreamingProcessor` ⇒ 我们在 `GENERATION_STARTED` 重新包一次 ✓
· 拿到的是**逐 tick 的累积原文**（ST 自己算好的 `this.continueMessage + text`）✓
· 重排后只写 `messageTextDom.innerHTML` ✓ 其它节点一个字节不碰 ✓

**安全阀**（为什么可以放心开）✓：
```
① 开关 streamLiveFormat **默认关** ✓（面板「性能」组里勾选 ✓）
② 节流 120ms —— 不是每个 token 都重排
③ 只有**认得出来是我们的行**才接管 ✓（hasOurLines）
   认不出 ⇒ 保留 ST 原样输出 ✓ —— 永不丢字 ✓
④ 插件总开关关掉时一并停用 ✓
```

**本体改动：无** ✓（§0.5 第 3 条要求的汇报：本轮未改 ST 任何文件 ✓
 所以"ST 更新后怎么重新适配"这一问不适用 ✓）
夹具 795 / 0（新增 7 条：开关默认关 / 面板勾选框 / 包装实现 / 节流 / 只认我们的行 / 重新包 / 只动一个节点 ✓）。
说明：只改扩展 + 脚本 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）
## v1.8.4 (2026-10-14) — 按钮改挂 **ST 官方发送栏**（不再依赖别的扩展）

用户提醒：「我记得这个插件是不设限的，st本体允许插件做到什么地步，这个插件就做到什么地步」✓
⇒ 我据此把"能做到的"逐条对了一遍（见下），并把**扩展层就能做**的那条先做掉 ✓

**本版** ✓：三个按钮的挂载优先级改为
```
① ST 原生 #rightSendForm（官方按钮位，本体 index.html:8094）   ← 最稳，且不依赖任何扩展
② #cc-var-bar（card-compat，兼容旧版）
③ 自建 #cd-bar 挂进 #send_form（都拿不到时）
```
原生栏里再套一层自有容器 `.cd-bar-native`（紧凑横排、不换行 ✓ 不与官方按钮样式打架 ✓）。
⇒ 好处：**不再依赖另一个扩展的 DOM** ✓（它改名/改结构我们也不会挂不上 ✓）

**关于"动本体"的对表** ✓（本体授权在 AGENTS §0.5，逐条看有没有收益）：
| 能力 | 我们现在 | 动本体能多拿到什么 |
|---|---|---|
| `messageFormatting` 之前预处理 | **已有**（`formatHook`） | 无 |
| 改提示词组装顺序 | **已有**（直接写预设 `applyPresetRecipe`） | 无 |
| 原生按钮位 | **DOM 即可**（本版做到） | 无 |
| 事件钩子 | **已有**（6 个 `event_types`） | 无 |
| **流式逐 token 干预** | **做不到** —— 流式时先显示原文、生成完才变分镜 | **唯一真收益** |

⇒ 结论：**不是不碰本体** ✓ 而是当前功能都用不上 ✓；唯一值得动本体的是
「**让流式输出边出边排版**」✓（等你点头再动，那时按 §0.5 出可重放补丁 ✓）
说明：只改扩展 + 脚本 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）
## v1.8.3 (2026-10-14) — 默认**都渲染**；判定权交给用户（你选的 ✓）

**你选的**：「我自己维护黑名单」+「占位符继续原样保留」✓

**本版行为（静的、可预测的）** ✓：
```
① 默认**都渲染**我们的分镜（autoOffCardFrontend = false）
② respectCardFrontend = true ⇒ `<options>` / `[OPTIONS]` **一律原样留给卡**
   （不转换、不画我们自己的选项按钮；想用我们的选项 UI ⇒ 面板里把它关掉）
③ 哪张卡不合适 ⇒ 你自己判定：
   面板「这张卡不生效（自带美化的卡用它）」/ 发送栏「本卡生效/不生效」
```

**为什么默认不让位**（实测）：「卡自带美化」有两类 ——
| 类型 | 在哪 | 能否扫到 |
|---|---|---|
| 卡内 | 占位符 / TavernHelper `<%` / MVU | 能（71 张） |
| **卡外** | **全局用户脚本**：`unified_statusbar 统一状态栏` / `shujuku 数据库` | **扫不到** ✗ |

证据：`settings.json → extension_settings.__userscripts` 里就是这两个脚本 ✓；
它们**与卡无关、对所有卡生效** ⇒ 你举的「魔法少女们的坏妈妈 也有美化」就属这类 ✓。
而且这类画在**消息外部**，与我们在**消息内部**的分镜行**并不冲突** ✓
⇒ 所以"按卡自动让位"会**又漏又误** ✗ ⇒ 默认都渲染 + 你逐卡判定 ✓

**自动让位那段代码留着** ✓：把 `autoOffCardFrontend` 设成 true 即可启用（可用「强制启用」绕过 ✓）
**我没做的**（也说明一下）：我曾把「用户自己判定算了」理解成"删掉检测代码" ✗ ——
那是**过度解读**，你指出后我**已改回**你真正选的那条（只改默认值 ✓）✓

夹具 787 / 0（其中 4 条旧夹具改成"显式关掉开关来测选项转换功能"✓ 功能照样被测 ✓）。
说明：只改扩展 + 脚本 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）
## v1.8.2 (2026-10-14) — 判据回到"**真有渲染器才认**"（用户：「我怎么没看出来有美化」）

用户这句话把我问住了 —— **他说得对** ✗：
· 卡 JSON 里躺着 `<style>` / CSS 文本 ⇒ **没有渲染器就等于没生效** ✗（当然看不见 ✓）
· `## ` / `**加粗**` 是 **ST 自己**渲染的 ✗ ⇒ 根本不算"卡的美化" ✓
⇒ 于是 1.8.1 的 **97/107 是虚高且归因错误**的 ✗（我拿"文本存在"当"效果存在"了 ✗）

**真正能看见的效果只来自三类** ✓：
```
· 占位符 <StatusPlaceHolderImpl/> / <option/> / <StatusBar>   ← 由 card-compat 渲染 ✓（62 张）
· TavernHelper <%…%> 脚本                                    ← 装上且绑定到卡才跑 ✓（38 张）
· MVU / UpdateVariable                                       ← 变量状态栏 ✓（68 张）
```
**本版修** ✓：`cardHasFrontend` 回到只认这三类（`RENDER_RE`）⇒ **CSS 与 markdown 一律不算** ✗
⇒ 好处：`autoOffCardFrontend` 不会因为"卡里有 CSS 文本"就把插件关掉 ✗（1.8.1 会 ✗）
⇒ 你会看到的效果：**只有真正带状态栏/选项栏/脚本的卡才默认让位** ✓ 其余卡照常渲染我们的分镜 ✓

★ 教训记下来：**"文本里存在" ≠ "界面上有效"** ✗ —— 我上一版混淆了这两件事 ✓
夹具 +4（改成断言"只认渲染器、CSS/MD 不算"）。
说明：只改扩展 + 脚本 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）
## v1.8.1 (2026-10-14) — 判据补上纯 CSS 与 markdown 着色（用户：「这是美化？」）

用户指着一张卡（欲妈群）的楼问「这是美化？」—— **是** ✓，而且**揪出我口径漏了一类** ✗：
我原来的 `cardHasFrontend` 判据是"标签型"：`StatusPlaceHolderImpl` / `<option` / `<StatusBar>` /
`UpdateVariable` / `TavernHelper` / `stat_data` / `<%` ⇒ **只有 CSS 美化的卡会被漏掉** ✗。

**放宽口径后重扫 107 张卡**：
```
<style> 标签 84 · CSS 规则 86 · TavernHelper <% 38 · 前端占位符 62 · MVU/变量 68
markdown 着色（## / **…** / *#*#）84
★ 任一命中 = 97 / 107   ← 我上一版报的是 89（偏小 ✗）
另：全局世界书 99 份里 39 份含样式注入（与具体卡无关，影响所有卡）
```
**本版修** ✓：`cardHasFrontend` 改成三者取或 ——
`FE_RE`（标签型）· `CSS_RE`（`<style>` 或 `.x{…}` 规则）· `MD_RE`（`## ` / `**…**` / `*#*#`）✓
⇒ 于是像「欲妈群」这种**六项全中**（style/css/th/ph/mvu/md ✓）的卡会被正确识别 ✓
⇒ 它们默认走 `autoOffCardFrontend`（对这张卡完全不动作 ✓）—— 与 1.8.0 的行为一致，只是**判定更全** ✓
夹具 +4。说明：只改扩展 + 脚本 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）
## v1.8.0 (2026-10-14) — **卡自带前端 ⇒ 默认对这张卡完全不动作**

用户看着「灯火幽微」那张卡（画像框 + 正文/图鉴/修炼…状态栏 + 推进输入行，全屏都是卡自己画的）说：
「这个你都没测出来」—— **说得对** ✗。
我上一版只做到"不抢它的选项栏" ✓，却**没据此改变主行为** ✗：插件照样重排这种卡的消息
⇒ **很可能破坏它的整屏 UI** ✗。

**本版（把你的原话落实得更彻底）** ✓：
· 新增 **`autoOffCardFrontend`（默认 true）** ✓：卡自带前端 ⇒ `effectiveConfig()` 直接返回
  `enabled:false, autoOff:true` ⇒ **不重排消息、不画自己的选项栏** ✓（等同面板按「本卡不生效」✓）
· **可以强制启用** ✓：这种卡上按发送栏的「本卡生效/不生效」会写 `perCard[key].force = true`
  （提示「⚠ 它自带前端，可能与卡的美化冲突」✓）再按一次取消 ✓
· 判定沿用 `cardHasFrontend`（扫当前卡 JSON：`StatusPlaceHolderImpl` / `<option` / `<StatusBar>` /
  `UpdateVariable` / `TavernHelper` / `stat_data` / `<%` ✓ 按卡缓存 ✓）

**依据（107 张卡实测）**：
```
★ 89 / 107 张卡自带美化（<style> / CSS 规则 / TavernHelper <% 脚本）
   例：武侠·江湖 <%×2202 · 卿卿 CSS×2387 · 独占配信 <style>×34 / CSS×660 · _碎界纪元 CSS×793
★ 全局世界书 99 份里 38 份含 <style> 或 <%
```
⇒ 这些卡的界面**由它们自己画** ⇒ 我们插手只会打架 ✗ ⇒ **默认让位** ✓ 最省心 ✓
夹具 +6。说明：只改扩展 + 脚本 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）

