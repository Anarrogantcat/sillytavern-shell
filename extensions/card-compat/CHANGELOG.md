# 更新日志
## [0.3.0] - 2026-09-20
### 修复
- **卡弹出「错误详情：YAML格式错误: bad indentation of a mapping entry (6:9)」、面板整块渲染不出**（用户实测截图，角色卡「天狐3」，聊天数据已逐行核对）：
  - **病灶一**：列表项写成行内映射，后面的兄弟键却缩进更深 ——
    ```- 用户: "涂山清璃"` + 下一行 `行动: "…"`（比键所在列更深）→ js-yaml 直接抛错
  - **病灶二**：引号标量后面又跟了「, 文字」（模型把两句写在一行）：`穿搭: "长裙堆叠。", 衬衫由于贴合而产生褶皱。`
  - **修法**（新函数 `repairYamlStructure`，开关 `fixYamlStructure` 默认开，面板第②组）：
    - 行内标量**下沉**成子映射的第一个键（默认 `名字`），兄弟键保持不动 → `- 用户:` + `名字: "…"` + `行动: …`
    - **为什么下沉、而不是把兄弟键左移**：该卡渲染脚本 `createCharacterCard()` 要求 `userItem[用户]` 必须是**对象**（不是对象就整张卡不渲染）；把兄弟键左移会让它变成字符串 → 卡片直接消失。已按卡源码逐一核对
    - 兄弟键里已经有名字类键（`名字/姓名/名称/name`）→ 只删掉行内的冗余标量
    - 引号后跟「, 文字」→ 把文字并回引号内（左侧已是句末标点就不再补逗号）
  - 统计新增「结构修复 N」，日志 `yaml-structure-fixed`
- 夹具 `scripts/compat-logic-test.mjs` **111 → 121 项**：新增 10 条，含**用真实病灶块**做 js-yaml 端到端断言（修复前解析失败 / 修复后 `用户列表[0].用户` 是对象且带 `名字` / 用户数与选项数不变 / 块外正文不动 / 本来就合法的块一处不动）
### 变更
- 版本号按「第三位最多到 6」的规则从 0.2.9 进位为 **0.3.0**（0.2.7~0.2.9 已越过 patch 上限，之后回到规则）

## [0.2.9] - 2026-09-20
### 修复
- **「必须刷新页面，状态栏才变回面板」**（用户实测现象：刷新再打开就好了）—— 根因链（逐层读本机文件核实）：
  1. 卡的「状态栏美化」正则把 `<StatusPlaceHolderImpl/>` 替换成一份 `html 围栏` 的状态栏模板（本例 5126 字），ST 的 markdown 把它渲染成 `<pre>` 代码块；酒馆助手（TavernHelper）再把这类 `<pre>` 转成前端 iframe 面板。
  2. 酒馆助手**只在** `chatLoaded` / `MORE_MESSAGES_LOADED` 时做全量转换（`$('#chat').find('pre')`），运行时只监听 `CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` / `MESSAGE_UPDATED` / `MESSAGE_SWIPED` 做「单楼增量」。
  3. ST 的 `updateMessageBlock(id, m, {rerenderMessage:true})` **只重建 .mes_text，全程不发任何事件**（`MESSAGE_UPDATED` 只在手动编辑消息时发）→ 本扩展修正正文后重渲染，已经把面板拆成源码 `<pre>`，酒馆助手收不到通知 → 停在源码状态，直到刷新页面触发全量转换。
  4. 触发条件由 0.2.8 引入：`stripUndeclaredBlocks` 真正生效后，模型每轮回显的块都会被删 → **每轮都触发重渲染**，症状才暴露（0.2.7 及之前清理是死代码，几乎不重渲染）。
- 修法一 **`nudgeRender`（默认开）**：每次重渲染后补发一次 `event_types.MESSAGE_UPDATED`（正是酒馆助手单楼增量监听的四个事件之一，语义即「本条消息被更新」）→ 前端块立刻重画，无需刷新页面。
- 修法二 **`rerenderOldFloors`（默认关）**：`normalizeRecent()` 扫最近 N 楼时，历史楼层只改文本 + 存盘、**不动 DOM**（不拆已经画好的面板），最新一楼仍重渲染并补发事件。
### 变更
- 面板第⑤组新增两个开关：「重渲染后补发事件」「历史楼层修正后也重渲染」
- 夹具 `scripts/compat-logic-test.mjs` **102 → 111 项**：新增 9 条（补发函数的存在性 / 事件名 / 开关、两处重渲染后都补发、历史楼 rerender 分支、两个默认值、面板开关、中英文案）

## [0.2.8] - 2026-09-20
### 修复
- **0.2.6 的「未声明块清理」实际从未生效**：那段代码被误插进 `strictCheckMessage`，里面引用了不存在的 `res` / `changed`，一进入就抛 ReferenceError 又被外层 try/catch 吞掉 —— 模型回显的 <world_setting> 等块其实没被删。现已放回 `guardMessage` 入口，成为守护第一步。
### 新增
- P1 ① **MVU 写回兜底**：`writeBackMvu()` + 面板按钮「用 MVU 解析并写回当前层」；API 缺失时日志与气泡明确提示可点 MVU 面板的「重新处理变量」
- P1 ② **「本卡要求 vs 本轮实际」对照表**：面板第③组按卡世界书的 `变量更新规则` 逐项列出必更字段的 ✅/❌，并列出模型实际写入的路径
- P1 ③ **连续缺块气泡提醒**：卡的变量块连续 3 楼未出现 → `toastr` 气泡一次（同一问题 10 分钟内不重复），`toastOnFail` 可关
- P1 ④ **角色卡档案缓存**：`profileOf()` 60 秒 TTL，换聊天 / 手动「重新读取角色卡数据」即失效（世界书很大时每层都重新解析会卡界面），`profileTtlMs` 可调
- P2 ⑤ **变量路径白名单**：`extractAllowedPaths()` 从规则条目抽路径（缩进结构 + 显式 `/路径` + 示例代码 `_.set('角色.字段')` / `"path":"/…"`，含模板组展开）；`validatePatchPaths()` 分「声明命中 / 组内未声明 / 越界」三档，越界**只提示不改写**；面板统计「越界路径」，对照表列出
- P2 ⑥ **覆盖度历史与趋势**：面板顶部方块条（▁▂▃▄▅▆▇█）+ 最近 10 轮平均覆盖率与前 10 轮对比箭头
- P2 ⑦ **多块记账**：`blockPresence()` 统计同一结构块在一条回复里的出现次数（重复输出 / 正文一份结尾一份）；`extractUpdateBlocks()` + `parsePatchOps()` 支持一条回复里多个 <JSONPatch> 片段，覆盖度按全部块统计
- P2 ⑧ **面板分组**：设置面板拆成「① 守护与修复 / ② 结构块与变量块 / ③ 本卡要求 vs 本轮实际 / ④ MVU 联动 / ⑤ 界面与诊断」五组
- P3 ⑨ **MVU 联动**：探测 `Mvu` API（版本 / parse / read / write）并显示；`mvuCanParse()` 用 `parseMessage` 只读试解析本轮变量块，失败计入「MVU 解析失败」；检测 MVU 自己的「额外模型解析」是否开启 —— 开着时本扩展的自动补变量**主动让位**避免双写；新增 `window.CardCompat` 对外钩子（profile / guard / coverage / validatePaths / applyToMvu / writeBack / mvu / invalidate / stats / trend）
- P3 ⑩ **面板双语**：中英两套文案 + 「自动 / 中文 / English」选择器（自动跟随浏览器语言）
### 变更
- 夹具 `compat-logic-test.mjs` **76 → 102 项**：新增模板组展开、路径白名单抽取、三档路径校验、多块记账、多 JSONPatch 段解析共 21 条断言，外加入口顺序回归 5 条（直接读 `index.js` 源码，断言清理逻辑在 `guardMessage` 内、不再落在 `strictCheckMessage`）
- `logic.js` 新增导出 `normalizePath` / `expandTemplateGroups` / `parsePatchOps` / `extractUpdateBlocks` / `extractAllowedPaths` / `validatePatchPaths` / `blockPresence`；`extractRequiredFields` 改为复用 `expandTemplateGroups`、`validatePatchBlock` 改为复用 `parsePatchOps`（对外行为与返回值不变）

## [0.2.7] - 2026-09-20
### 新增
- **变量块兜底**（面板开关 `autoFixVars`，默认**关**）：角色卡声明了变量块（如 MVU `UpdateVariable`）而某层回复**缺失**时：
  - 用「只输出补丁」的**专注短提示词**（带卡的 `变量输出格式`、必更字段、本轮正文、玩家上一条输入）静默生成一次（`generateQuietPrompt`，不产生楼层）；失败用**严格版**短提示词重试一次
  - 校验：抽 `<UpdateVariable>` 或裸 JSONPatch 数组 → `JSON.parse` → 检查 op/path 合法且非空，**校验通过才写盘**
  - 落地：变量块追加到该层消息（卡的正则会隐藏它）→ 重渲染 → 再尝试用 **MVU 公开 API**（`parseMessage` + `replaceCurrentMvuData`/`replaceMvuData`）**真正写回变量**；API 不可用时只追加文本并在面板说明
  - 安全阀：同一层只试一次；**连续失败 2 次暂停 10 分钟**；日志 `varfix-request/ok/invalid/applied/not-applied/error/paused`；面板统计「补变量 成功/尝试」
  - 面板另有「立即补当前楼层变量块」按钮（手动触发）
### 变更
- 夹具 `compat-logic-test.mjs` **65 → 76 项**：抽取/校验/提示词 12 条断言（坏 JSON、空数组、缺 path、严格版更短、正文截断等）


## [0.2.6] - 2026-09-20
### 新增
- **清理「本卡未声明、也没人渲染」的结构块**（`stripUndeclaredBlocks`，面板开关 `stripUndeclared` 默认开）：
  - 实测病灶：模型把**世界书原文回显**成 `<world_setting>…</world_setting>`（截图里整段"城市总览/地图结构/详细地点"铺在聊天里、还带黑代码块），或自创 `<status_block>`、`<konatan_planning~>` 之类标签 —— 卡的渲染正则不认它们，于是**原文裸露、版面被撑爆**
  - 规则：只处理**成对**块；标签不在「本卡声明集合」（卡的 findRegex / replaceString / 酒馆助手脚本里出现过的标签，含中文）且不在保留名单（预设块 `tucao/current_event/progress/options/htmlcontent…` 与通用 HTML）时删除；**只有开标签的块只报告不删**（怕误伤半截 HTML）
  - 面板统计新增「清块 N」，日志 `undeclared-block-stripped` / `unclosed-block`
- 新增 `broadTagsOf()`：宽松标签抽取（支持中文标签，如 `<正文>`、`<女主A_名字>`），`buildProfile` 因此得到 `rawTags` —— 卡自己声明的格式标签集合
- 生成前提醒：触发条件纳入 `rawTags`；当卡只有格式标签时列出「本卡前端要求正文里包含这些标签」；新增通用要求「不要把世界书/设定原文回显进正文，也不要输出本卡没声明的结构块」（**刻意不点具体标签名**，避免诱导模型输出）

## [0.2.5] - 2026-09-20
### 修复
- 自带库目录由 `vendor/` 改名为 **`assets/`**：仓库根 `.gitignore` 里有 `vendor/` 规则，导致扩展自带的 `js-yaml.min.js` **从未被提交**
  —— 本地索引算到 8 个文件、CI 检出后只有 6 个，清单校验直接判 STALE（发布被自愈步骤拦下，未产出安装包）
  - 现在 `assets/js-yaml.min.js` 会被正常跟踪；加载路径同步改成 `./assets/js-yaml.min.js`

## [0.2.4] - 2026-09-20
### 新增
- **结构块严格 YAML 校验**（真解析，不是启发式）：
  - 扩展自带 `assets/js-yaml.min.js`（js-yaml 4.3.0，MIT，附 `assets/js-yaml.LICENSE.txt`，已去掉 sourceMappingURL 尾巴、不带 BOM）
  - 懒加载：页面里已有 `window.jsyaml` 就直接用，否则按 `import.meta.url` 注入一次脚本；**消息里没有结构块时根本不加载**
  - 生成后自动校验（可用面板开关 `yamlStrict` 关闭）；解析失败 → 面板 `YAML 严格` 计数 + 日志 `yaml-strict-fail`（带首条错误信息），**只报告不改文本**
  - 面板新增「严格校验当前楼层」按钮（手动强制校验最后一层，通过也会给一行 `yaml-strict-ok`）
  - 库不可用时明确记 `yaml-strict-skipped`，不会静默
### 变更
- 夹具 `compat-logic-test.mjs` **54 → 59 项**：新增严格校验的正常/故障/修复后通过/无结构块/无库五类断言

## [0.2.3] - 2026-09-20
### 新增
- **结构块 YAML 预检 + 自动修复**（`guardBlockYaml()`，不依赖 js-yaml 的行级规则），覆盖实测能打挂卡前端解析的第二类写法：
  - 值**没加引号**但里面含 ``: ``（冒号+空格）或 ` #`（空格+井号）→ YAML 会当成嵌套键/注释，值被截断或整段解析失败 → 自动给整个值加英文双引号
  - 仍以「中文引号收尾」的写法继续修（0.2.2 的能力合并进同一入口）
  - `|` / `>` 字面量块内的行、块外正文、已经加引号的值：一律不动
  - 无法安全判断的（引号开了没闭合）→ **只报告**（面板 `YAML 疑点` 计数 + 日志 `block-yaml-issue`），绝不乱改
### 变更
- 面板新增两个开关：「修结构块里的引号错配」「含「: 」「 #」却没加引号的值自动加引号」（默认都开，可单独关）
- 面板统计新增「加引号」「YAML 疑点」两项；日志类型新增 `scalar-quoted` / `block-yaml-issue`
- 夹具 `compat-logic-test.mjs` **44 → 54 项**：含**用 js-yaml 端到端验证**「裸 `: ` 值修复前解析失败 → 修复后能取出用户列表」、`|` 块跳过、两个开关各自生效等

## [0.2.2] - 2026-09-20
### 修复
- **结构块引号错配导致状态栏「未解析到角色数据」**：模型把 YAML 字符串的**结束引号写成中文右引号 `”`（U+201D）**，例如
  `内心: "……契合。”` —— js-yaml 直接报错（`bad indentation of a mapping entry`），卡的前端解析不到 `用户列表`，面板就显示「未解析到角色数据」
  - 新增 `repairSmartQuotes()`：**只在角色卡声明的结构块内**逐行修复「值以英文引号开头、却以对应中文引号结尾」的情形（`"`+…+`”` → `"`+…+`"`；单引号 `'`+…+`’` 同理）；块外正文、本来就配对的行一个字不动
  - 实测用户当前会话 8 条 AI 楼层：**楼层 11、15 从「解析失败」变为「能取到 4 个角色」**，各修 1 行（字段 `内心`）；其余 6 层零改动
  - 面板统计新增「引号修复」计数，日志类型 `quote-repaired`
- 生成前端提醒新增一条：结构块内字符串引号必须用英文半角并配对（从源头降低复发率）

## [0.1.3] - 2026-09-20
### 新增
- **心跳痕迹**：加载时写入 `loadedAt / loadedVersion / runCount` 并保存到 ST 设置；每次守护记录 `lastRunAt / lastRun{id,changed,actions,card}`
  → 排查时可从 `settings.json` 直接确认「扩展是否加载、是否真的跑过、跑了什么」，不再依赖人工读面板

## [0.1.1] - 2026-09-20
### 修复
- **流式模式下完全失效**：ST 的 `saveReply({fromStreaming:true})` 会跳过 `MESSAGE_RECEIVED`，导致守护从未执行；改挂 `GENERATION_ENDED` 兜住流式生成
- 修正文本后调用 `updateMessageBlock(id, msg, {rerenderMessage:true})` 触发重渲染，保证卡片正则能作用于修正后的文本
### 变更
- 「缺锚点时补锚点」默认改为**开**（只有卡自己定义过锚点、且不在隐藏白名单里才会补）
- 新增「自检当前楼层」按钮与「未接管」计数（渲染后校验卡脚本是否真的消费了标签）

## [0.1.0] - 2026-09-20
### 新增
- 锚点守护：从角色卡的 placement=2 正则脚本自动推导锚点标签族，缺失按设置补、未闭合自动补闭合
- 数据块守护：`<UpdateVariable>` 等数据块不改内容、只在未闭合时补闭合，缺失只报警不伪造
- 数据新鲜度检测：对比连续两轮的第N天/日期/时刻/地点/天气，全程一致时提示"数据疑似未更新"
- 消息区字号：`zoom` 缩放 + 字号下限 `max(Npx,1em)`
- 设置面板：总开关、补锚点开关、闭合修复开关、新鲜度提示、缩放与字号下限滑条、最近动作日志
### 说明
- 安装位置：`data/default-user/extensions/card-compat/`；不改 ST 本体与角色卡