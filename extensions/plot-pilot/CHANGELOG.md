# 更新日志
## [0.1.4] - 2026-09-20
### 变更
- **署名**：扩展信息块与 manifest 的作者改为 **小肥鱼（AI）· 染喵**（原为 sillytavern-shell）

## [0.1.3] - 2026-09-20
### 新增
- **扩展信息块**（面板顶部，参考「酒馆助手 Tavern Helper」那张扩展信息卡）：名称 + `Ver 0.1.3` + 作者 / 许可 / 项目主页 + 免费使用与风险说明（本扩展只往输入框发指令，不改消息、不改变量）
- **「查看日志」按钮**：ST 原生 `callGenericPopup`（`POPUP_TYPE.TEXT`，wide + large + 可滚动）展示更新日志；正文取自**扩展目录里的 CHANGELOG.md**（离线可用、带缓存），附 GitHub 直链
- `renderChangelogMarkdown()`：极简 Markdown → HTML（先整段转义再白名单替换，不会执行日志里的 HTML）
- 对外钩子新增 `window.PlotPilot.showChangelog()`
### 变更
- 夹具 `plot-pilot-test.mjs` **49 → 56 项**：新增 7 条（Markdown 渲染 3 条 + 面板与弹窗接线 4 条）

## [0.1.2] - 2026-09-20
### 新增
- 面板新增开关 **「任何卡都显示「推进节点」（完全没探测到也用兜底文案）」**（`showAdvanceAlways`，默认关）——
  用户反馈「有些卡只有续写、另一个没有」，根因是探测档位：**41/92 张卡完全没有任何剧本/蓝图信号 → 只显示续写**（按设计行为）。
  想全局统一成一个样就打开这个开关；只想某几张卡显示，用「本卡设置 → 推进节点 → 本卡显示」更精准（每卡覆盖优先级高于全局开关）。
### 修复
- `shouldShowAdvance()` 原先第一行是 `if (!det || !det.has) return false;`，在「无探测」时直接短路，导致 `showAdvanceAlways` 永远无效 → 改为只在 `!det` 时短路
### 变更
- 夹具 `plot-pilot-test.mjs` **45 → 48 项**：新增「无信号默认隐藏 / 开 always 后显示 / 本卡隐藏优先于 always」3 条真值表断言

本扩展的所有重要变更都记录在此文件。

## [0.1.1] - 2026-09-20
### 修复
- 面板里 7 个文本输入框（续写/推进节点的按钮文字与发送内容、兜底内容、本卡文案）没有套 ST 的主题类 `.text_pole`，在深色主题下渲染成**浏览器默认白底** → 全部补上 `class="text_pole"`
- 样式表里加一条兜底规则：即使主题变量缺失，也用 `--black30a / --SmartThemeBodyColor / --SmartThemeBorderColor` 保证输入框是深色

## [0.1.0] - 2026-09-20
### 新增
- 首个版本：把酒馆助手脚本「继续按钮」改写为 SillyTavern 原生扩展，重命名为 **剧情推进器 Plot Pilot**
- 按钮条：发送栏上方注入「▶ 续写 / ⏭ 推进节点」，文案与发送内容均可配置
- 探测：`detectBlueprint()` 分强/弱/无三档，强信号（`blueprint_controller` 等）自动填入 `{var}` 变量名，弱信号默认隐藏推进按钮，避免在无剧本系统的卡上发出无意义指令
- 发送通道三选一：`api`（调用 ST `Generate()`）/ `dom`（模拟点击，等发送按钮可用）/ `auto`（优先 api，异常自动退回 dom）
- 配置持久化：从 `localStorage` 迁到 `extension_settings["plot-pilot"]`，并把旧脚本的 localStorage 配置一次性搬过来
- 每卡覆盖：显示/隐藏与文案可按角色卡单独设置
- 冲突保护：检测到旧酒馆助手「继续按钮」脚本时进入待命状态并提示，避免两套按钮
- 面板：状态汇总、探测结果、最近动作日志、防连点窗口、发送通道、本卡设置、清除本卡设置
- 公开 API：`window.PlotPilot.{cfg,detection,detect,recheck,continue,advance,sendText,setConfig}`
- 逻辑层 `logic.js` 与界面层 `index.js` 分离，配套夹具测试 `scripts/plot-pilot-test.mjs`