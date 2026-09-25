# 剧情推进器 plot-pilot v0.2 完整方案

> 状态：**方案（未实现）**。本文只描述要做什么、怎么做、怎么验；代码改动从阶段 1 开始按版本号逐个落地。
> 撰写时间：2026-09-20 ｜ 当前版本：**plot-pilot v0.1.5**（VERSION 常量在 `extensions/plot-pilot/index.js`）｜ 壳版本 **v2.2.13**
> 【2026-09-25 校准】下面「0. 现状」与阶段版本映射写于 plot-pilot v0.1.2 / 壳 v2.0.4；`0.1.3～0.1.5` 已落地的是**扩展信息卡 + 查看日志 + 信息卡折叠**，方案正文里 F1～F9 的功能（推进目标 / 选项推进 / 快捷键 / 连推 / 联动）**仍未实现**。

---

## 0. 现状（v0.1.2 实测）

### 0.1 已具备

| 能力 | 位置 |
|---|---|
| 剧本系统探测（强信号 12 个关键词 + 弱信号 12 个 + 扩展键名） | `logic.js · detectBlueprint()` |
| 两枚按钮（续写 / 推进节点），按钮条注入 `#send_form` 上方 | `index.js · ensureBar() / applyBar()` |
| 三条发送通道（`api` 直调 `Generate('normal')` / `dom` 模拟点击 / `auto`） | `index.js · sendViaApi / sendViaDom / pickSendStrategy` |
| 每卡覆盖（显示与否 + 文案） | `logic.js · resolveCard() / sanitizeConfig().cards` |
| 旧「继续按钮」脚本冲突检测 + 待命（`YDContinue` / `#yd-quick-continue-wrapper`） | `logic.js · legacyStandby() / detectLegacySignals()` |
| 配置迁移（localStorage `yd_continue_cfg_v2` → extension_settings） | `index.js · migrateLegacyConfig()` |
| 对外钩子 | `window.PlotPilot`（version/cfg/detection/recheck/continue/advance/sendText/cardName） |
| 纯逻辑夹具 49 项 | `scripts/plot-pilot-test.mjs` |

### 0.2 已知缺口（按用户实际使用痛感排序）

| # | 缺口 | 现状证据 |
|---|---|---|
| G1 | **推进目标不可指定**：只能发「推进至下一个 step」，无法说「推进到 PG.5」 | `DEFAULTS.advanceText` 只有一个模板，`{var}` 只能替换变量名 |
| G2 | **不知道卡里到底有哪些 step**：面板只显示「有/疑似/无」 | `formatDetection()` 只输出置信度 |
| G3 | **选项推进缺失**：模型常在回复末尾给 `<options>` 1/2/3，玩家只能手打 | `index.js` 无解析 `<options>` 的代码 |
| G4 | **没有快捷键**：每回合都要移鼠标点按钮 | 无 keydown 监听 |
| G5 | **只能推进一格，无法连推**：连续推进要一直点 | `busy` 在 `clickGuardMs` 内直接丢弃点击（`send()` 里 `if (busy) return;`） |
| G6 | **推进是否成功无反馈**：step 没变也不知道 | 无推进前后对比 |
| G7 | **与 card-compat 无联动**：本地模型 30% 概率漏 `<UpdateVariable>`，推进后变量仍不动 | 两扩展互不感知 |
| G8 | **按钮位置/外观不可调**：只能固定在发送栏上方 | `ensureBar()` 硬编码 `form.prepend(bar)` |
| G9 | **面板只有中文** | 与 card-compat 0.13.2 的双语能力不一致 |
| G10 | 探测为「无信号」的卡（实测 41/92）只能显示「续写」 | ——（这是设计，非缺陷；但可让 F1 的「指定目标」也对其生效） |

**实测背景（v2.0.2 全量核查）**：92 张卡里强信号 2 张、弱信号 49 张、完全无信号 41 张 —— 所以 v0.2 的所有新功能都必须**对无信号卡优雅降级**（用兜底文案），不能假设卡里一定有蓝图变量。

---

## 1. 目标与非目标

### 目标
1. 每次点击都能表达**明确意图**（推进到哪一步 / 选哪个选项 / 连推几轮），不再只有「下一个」。
2. 推进**可验证**：能告诉你这一步到底推没推动；没推动就停下来报警，而不是静默空转。
3. 与 card-compat 打通，让「推进剧情」和「状态栏数据更新」不再是两件互不相干的事。
4. 全部新逻辑进 `logic.js`（不依赖 ST/DOM），每一条都有夹具断言。

### 非目标（v0.2 明确不做）
- 不做「自动决定选哪个选项」的 AI 决策（那是玩家的乐趣，也容易翻车）。
- 不接管`酒馆助手`自身的脚本系统，不修改任何角色卡与世界书。
- 不实现「跳过剧情/回滚楼层」这类破坏性操作。
- 不新增第二条发送通道（继续复用 `api/dom`）。

---

## 2. 分阶段实施

> 版本号规则（2026-09-25 校准）：patch **无上限**，所以节奏就是 0.1.2 → **0.1.3 → 0.1.4 → 0.1.5 → 0.1.6 → 0.1.7 …**；只有要加新能力时才进 minor（**0.2.0**）。
> 每阶段独立可发布，互不阻塞；每阶段结束都要：`logic.js` VERSION + `manifest.json` + `CHANGELOG.md`（扩展级）+ 仓库根 `CHANGELOG.md`（壳版本，因为扩展内容变了）+ `extensions/index.json` 重建 + 夹具全绿。

### 阶段 1 — v0.1.3：说不清就报错（推进目标 + 队列化）

**F1 推进目标可指定（G1）**
- 配置新增 `advanceTarget: ''`（string，≤80 字），面板第 1 组新增输入框「推进目标（可留空）」，例：`PG.5` / `第 3 章` / `第二幕`。
- `advanceText` 模板新增两个占位符（与既有 `{var}` 并存，向后兼容）：
  - `{step}` → `advanceTarget`（空则整段连同前面的连接词一起省略，避免出现「推进到 」（尾部空格））
  - `{next}` → 由 F2 推出的「下一个 step 名」（取不到则省略）
- 新增纯函数 `buildAdvanceText(cfg, det, ctx)` 升级版（保留旧签名兼容：第三参数缺省时行为不变），并按 0/1/多个占位符做**格式化断言**。
- 发送前 `normalizeAdvanceText()`：折叠连续空格、去掉「到 / 至」后的孤立标点，保证发出去的中文可读。

**F2 从卡里读出 step 候选（G2）**
- 新增 `extractSteps(profile)`：在 `detectBlueprint` 用到的同一份卡文本里扫描形态如 `PG.1 / PG.5 / STEP 3 / 第3章 / 第 12 节 / act 2` 的条目，去重、保序、上限 30 条。
- 面板显示 `探测：有剧本系统（变量名：X）｜ 找到 12 个 step：PG.1…PG.12`；「推进目标」输入框右侧给一个 `<datalist>` 下拉，点选即填。
- 采不到时明确写「未在卡里找到 step 名（可手动填）」——**不猜、不编**。

**F3 点击队列化（G5 的轻量部分）**
- `send()` 现在的 `if (busy) return;` 改为：把本次请求放进长度为 1 的队列，当前生成结束后自动补发，并在按钮上加 `pp-queued` 角标；同时 log `queued`。
- 新增配置 `queueClicks: true`（默认开）；关闭即回到旧行为。

**夹具**：`extractSteps` 6 条、`buildAdvanceText` 占位符 8 条、`normalizeAdvanceText` 3 条、队列状态机 4 条（纯函数 `nextQueueState()`）→ 预计 **49 → 70**。

### 阶段 2 — v0.1.4：选选项 + 快捷键

**F4 选项推进（G3）**
- 新增 `extractOptions(mesText)`：解析上一条 AI 回复里的
  - `<options>` / `<option>` 块（每行一条，容忍 `1.` / `1)` / `- ` 前缀）
  - 裸编号行（`^[1-9][.、)]\s*`）作为兜底，仅在 **同一行区间连续出现 ≥2 条** 时才认（避免把正文里的「1.」误当选项）
  - 返回 `[{ index, text, source }]`，上限 6 条
- 按钮条右侧渲染「①②③」小按钮（最多 6 个，超出收进 `+N` 菜单）；点击发送可配置模板 `optionText: '我选择选项 {n}：{text}'`（`{n}` 阿拉伯数字、`{text}` 原文，`{n_cn}` 中文数字）。
- 解析不到选项时这排按钮整体隐藏（**不显示空按钮**）。

**F5 快捷键（G4）**
- `Alt+Enter` = 续写；`Alt+Shift+Enter` = 推进节点；`Alt+1..6` = 选第 N 项（仅在有选项时）。
- 配置 `hotkeys: true`（默认开）、`hotkeyNeedAlt: true`（防止误触）。只在 `#send_textarea` 未聚焦或空白时生效，**绝不劫持玩家正在输入的内容**。

**夹具**：`extractOptions` 10 条（含「只有一条裸编号 → 不认」的反例）、`formatOptionText` 4 条、`matchHotkey(event-like)` 4 条 → 预计 **70 → 88**。

### 阶段 3 — v0.1.5：连推与校验

**F6 自动连续推进 N 轮（G5）**
- 配置 `autoRounds: 1`（1…10）、`autoIntervalMs: 1200`；按钮条出现「连推 ×N」，点一次按 N 轮依次发送。
- 实现：一串 `await send(...)` 之间等 `MESSAGE_RECEIVED / GENERATION_ENDED`，不做定时器盲发（避免打断用户手动输入）。
- 任意一次点击 / 按 Esc / 关闭开关 → 立即中止，剩余轮次清零；按钮上显示「连推中 2/5」，log 每轮一条。
- 状态机做成纯函数 `autoStateStep(state, event)` 以便夹具覆盖「用户中途插话」「生成失败」等分支。

**F7 推进结果校验（G6）**
- 推进前记录 `before = currentStepSignal()`；收到新回复后取 `after` 对比：
  - `currentStepSignal()` 优先读 MVU 变量（`window.Mvu.getCurrentMvuData()`，键名取 `det.varName` 或卡内 step 命名），退化到从最新消息里 `extractSteps` 的最大序号。
  - 一致（没变） → `toastr.warning`「这一步似乎没有推进（step 仍是 X）」+ **自动停止连推**，log `advance-stalled`。
  - 变了 → log `advance-ok (X → Y)`，面板「最近推进」记一条。
- 无法判定时（读不到 step）只记 `advance-unknown`，**不误报**。

**夹具**：`autoStateStep` 8 条、`compareStepSignal` 6 条（含中文序号 `PG.十` 之类不可比时不误报）→ 预计 **88 → 102**。

### 阶段 4 — v0.2.0：联动与外观

**F8 与 card-compat 联动（G7）**
- 前提：card-compat **0.13.2** 已暴露 `window.CardCompat`（含 `version / guard / coverage / writeBack / mvu() / stateOf() / recompute()`，完整清单见 `extensions/card-compat/README.md`）。
- 配置 `prepVarsBeforeAdvance: false`（默认关，涉及一次静默生成，必须用户主动开）：
  - 推进前调用 `CardCompat.coverage(lastId)`；若必更字段未覆盖 → 调 `CardCompat.writeBack(lastId)`（card-compat 内部用 `parseMessage` 写回 MVU）
  - 成功 → log `prep-ok` 后再发推进指令；失败 → 气泡提示「变量没补上，可能仍是空转」但**不阻断**推进（玩家意图优先）
- 联动是**单向可选**的：没装 card-compat 时 `window.CardCompat` 不存在 → 该配置项自动隐藏并说明原因。

**F9 按钮位置与外观（G8）**
- 配置 `barPlacement: 'above' | 'below'`、`compactBar: false`、`showStepBadge: true`。
- 实现上把 `form.prepend(bar)` 改为按 `barPlacement` 选择 `prepend` / `append`；紧凑模式只显示图标 + 当前 step；`showStepBadge` 在按钮上叠加「PG.3 → PG.4」徽章。
- 必须保持「ST 重绘后能被 MutationObserver 补回」的既有行为（`ensureBar` 幂等）。

**F10 面板中英双语（G9）**
- 照搬 card-compat 0.13.2 的做法：面板文案表 `STRINGS.zh / STRINGS.en` + `lang: 'auto' | 'zh' | 'en'`（auto 跟随 `navigator.language`），面板第一组加语言选择器，切换后重建面板。

**F11 当前/下一个 step 显示**
- 面板与按钮徽章共用 `currentStepSignal()`：显示「当前 step：X ｜ 下一：Y」，读不到则显示「（未探测到 step）」。
- 只读不写：**本扩展永不修改变量**（写回一律交给 card-compat），避免两个扩展互相覆盖。

**夹具**：`pickBarPlacement` 3 条、`linkageDecision(state)` 5 条（有没有 CardCompat、覆盖率、开关）、`panelStrings` 完整性校验 3 条 → 预计 **102 → 113**。

---

## 3. 接口与配置总表（新增部分）

| 配置键 | 类型 | 默认 | 阶段 | 说明 |
|---|---|---|---|---|
| `advanceTarget` | string ≤80 | `''` | 1 | 填进 `{step}` 的目标 |
| `queueClicks` | bool | `true` | 1 | 生成中点击排队而不是丢弃 |
| `optionText` | string ≤2000 | `'我选择选项 {n}：{text}'` | 2 | 选项按钮发送模板 |
| `hotkeys` | bool | `true` | 2 | Alt+Enter / Alt+Shift+Enter / Alt+数字 |
| `autoRounds` | int 1…10 | `1` | 3 | 连推轮数 |
| `autoIntervalMs` | int 300…10000 | `1200` | 3 | 轮间最小间隔 |
| `verifyAdvance` | bool | `true` | 3 | 推进前后对比 step |
| `prepVarsBeforeAdvance` | bool | `false` | 4 | 联动 card-compat 补变量 |
| `barPlacement` | enum | `'above'` | 4 | 发送栏上方 / 下方 |
| `compactBar` | bool | `false` | 4 | 紧凑按钮条 |
| `showStepBadge` | bool | `true` | 4 | 按钮上显示 step 徽章 |
| `lang` | enum | `'auto'` | 4 | auto / zh / en |

新增纯函数（全部进 `logic.js`，均可单测）：
`extractSteps / buildAdvanceText(升级) / normalizeAdvanceText / nextQueueState / extractOptions / formatOptionText / matchHotkey / autoStateStep / compareStepSignal / pickBarPlacement / linkageDecision`

对外钩子 `window.PlotPilot` 追加：`steps()`、`options()`、`currentStep()`、`autoAdvance(n)`、`stopAuto()`。

---

## 4. 测试计划

| 阶段 | 夹具文件 | 预计项数 | 关键断言 |
|---|---|---|---|
| 1 | `plot-pilot-test.mjs` | 70 | 占位符缺省/组合/超长截断；step 抽取保序去重；队列「生成中只排队一次」 |
| 2 | 同上 | 88 | `<options>` 与裸编号；「单条裸编号不算选项」；快捷键不劫持输入中内容 |
| 3 | 同上 | 102 | 连推状态机 「用户插话即中止」「失败即中止」；step 不可比时不误报 |
| 4 | 同上 | 113 | 无 `window.CardCompat` 时联动项隐藏；中英文案表 key 一一对应 |

CI：`.github/workflows/release.yml` 的夹具步骤已在 v2.0.4 加入 `plot-pilot-test.mjs`（当前壳 v2.2.13），之后每阶段只需保证它绿。

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| `{step}` 语义被模型误解（卡里根本没有 PG.x） | 模板里保留「推进至下一个 step」的原文结构，只在玩家填了目标时才追加；发送前提示发出去的原文（按钮 `title` + 面板预览） |
| 连推把 API 额度烧掉 | 默认 `autoRounds=1`（等于没开）；每次连推前气泡确认一次；随时可中止 |
| 自动补变量（F8）触发静默生成，模型答非所问 | 默认**关**；只调 card-compat 的 `writeBack`（不新增生成），失败不阻断 |
| 选项解析误判正文编号 | 只在 `<options>` 块内无条件认；裸编号必须同段连续 ≥2 条 |
| 快捷键与 ST 自身绑定冲突 | 只用 `Alt` 组合且要求输入框为空；配置可整体关闭 |
| step 校验误报「没推进」 | 读不到 step 一律 `advance-unknown` 不算失败；只有两侧都能解析且相等才报警 |
| 与旧「继续按钮」脚本同场 | 保持既有 `legacyStandby` 待命逻辑，新按钮一并受其约束 |

---

## 6. 版本与发布节奏

1. 每阶段一份代码提交：`extensions/plot-pilot` 改动 + 扩展 `CHANGELOG.md` + `manifest.json` 版本 + 仓库根 `CHANGELOG.md` 一节 + `extensions/index.json` 重建 + `package.json` 版本递增（壳版本同步走）。
2. 壳版本对应（2026-09-25 按现行规则重算）：阶段 1 → **v2.2.13**（本文档校准版），阶段 2 → v2.2.14，阶段 3 → v2.2.15，阶段 4 → v2.2.16；只有加新能力时才进 minor（`2.3.0`），不要再按「patch ≤ 6」进位。
3. 每个 tag 推送后由 CI 出 Lite 安装包并发布；已装套壳的用户可经「检查扩展在线更新」拿到扩展，无需重装壳。

---

## 7. 验收标准（可验证）

- [ ] 面板填 `advanceTarget=PG.5` 后点「推进节点」，按钮 `title` 与日志里发出去的都是「请根据当前 blueprint_controller，推进至 PG.5」（不含多余空格/标点）。
- [ ] 卡里能扫到 step 时，输入框下拉可点选；扫不到时明确显示「未在卡里找到 step 名」。
- [ ] 上一条回复带 `<options>` 时，按钮条出现等量选项按钮；点第 2 项发出的文本包含该选项原文；没有选项时这排按钮不出现。
- [ ] 生成中点「推进节点」不丢点击，生成结束后自动补发一次（日志有 `queued` 与后续 `sent`）。
- [ ] `Alt+Enter` / `Alt+Shift+Enter` 生效，且在输入框已有文字时不触发。
- [ ] 连推 ×3：日志出现 3 条 `advance-ok`（或中途 `advance-stalled` 并自动停止），按钮显示进度。
- [ ] step 没变时出现气泡告警且连推停止；读不到 step 时不告警。
- [ ] 装上 card-compat 0.13.2 时联动项可见、可开；未装时该项隐藏并说明。
- [ ] 语言切到 English 后面板文案全英文，切回中文无残留。
- [ ] `node scripts/plot-pilot-test.mjs` 全绿（113 项），CI 夹具步骤通过。
