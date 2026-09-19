# SillyTavern Desktop Shell 更新日志

## v1.33.1 (2026-09-20) — 修复 card-compat 在流式模式下完全不执行
- 根因：ST 的 `saveReply({ fromStreaming: true })` 用 `!fromStreaming` 跳过 `MESSAGE_RECEIVED`，而优化预设默认开启了流式 → 守护从未触发
- 修复：`card-compat` v0.1.1 改挂 `GENERATION_ENDED`（流式结束）并在修正文本后调用 `updateMessageBlock(..., { rerenderMessage: true })` 重新渲染，保证卡片正则作用于修正后的文本
- 变更：「缺锚点时补锚点」默认改为开（仅对卡自己定义过、且不在隐藏白名单的锚点）
- 新增：设置面板「自检当前楼层」按钮 + 「未接管」计数（渲染后校验卡脚本是否真的消费了标签）
## v1.33.0 (2026-09-20) — 角色卡状态栏兼容：能力档案 + ST 扩展（第一阶段）
- 新增 `scripts/compat-scan.mjs`：角色卡/预设「能力档案」静态扫描器（卡内正则、酒馆助手脚本、世界书、全局与按预设作用域），实测扫描 93 张卡
  - 档案结果：带正则 80 张 / 带助手脚本 62 张 / 锚点来自正则 45、来自助手 28、无锚点 20；数据块来自正则 42、助手 8、无 43；风险卡 9 张（只有隐藏脚本、无锚点，禁止补锚点）
- 新增 `extensions/card-compat/`：ST 扩展源码（随仓库版本管理，不入 ST 本体）
  - 锚点守护：从卡的正则脚本推导锚点标签族（`<StatusPlaceHolderImpl/>`、`<StatusBar>`、`<status!>` 等），缺失按设置补、未闭合自动补结束标签
  - 数据块守护：`<UpdateVariable>` 等数据块**绝不改内容**，只在未闭合时补闭合；缺失只报警、不伪造
  - 数据新鲜度：对比连续两轮的第N天/日期/时刻/地点/天气，全程一致时提示"数据疑似未更新"
  - 消息区字号：`zoom` 缩放 + 字号下限 `max(Npx,1em)`（卡内写死 px 也能放大）
  - 运行时机：`MESSAGE_RECEIVED`（早于渲染与卡正则），只补标签、不动正文与数据
- 新增 `scripts/compat-install.mjs`：把扩展同步到 ST 数据目录（支持 `--dry-run`、哈希比对、manifest 校验）
- 新增 `scripts/compat-logic-test.mjs`：逻辑层夹具断言 12 项（锚点注入/闭合修复/隐藏白名单/数据块保护/新鲜度），实测 12/12 通过
- 说明：本阶段只做基础能力；工具箱合并（P1）与「兼容与检测」页签在后续提交中完成
## v1.32.1 (2026-09-20) — 修复 webview 增强全部失效（右键菜单等）
- 修复 v1.28.0 引入的回归：`<webview>` 的 preload 由 Electron 按 **CommonJS** 加载，写成 ESM `import` 会整份不加载
  （实测报错：`Unable to load preload script` / `SyntaxError: Cannot use import statement outside a module`）
- 受影响的全部功能：**ST 页面内右键菜单**、Ctrl+滚轮缩放上报、Ctrl+Shift+T/R/L 快捷键、alert/confirm/prompt 原生弹窗桥
- 做法：`webview-preload.js` → `webview-preload.cjs`（改回 `require('electron')`），`shell.html` 的 preload 属性、
  `package.json` 与 `electron-builder-lite.json` 两套打包文件列表同步更新，旧文件删除
- 实测验证：用真实 preload 在 webview 内派发 contextmenu，宿主收到 `ctxmenu` 消息；旧 ESM 版本同场景报错不加载
## v1.32.0 (2026-09-19) — 英文模式动态文案补全
- 新增 i18n-runtime.js：中英替换引擎（精确字典 → 片段规则多轮替换），取代 shell.js 里的内联实现
- 运行时改写的文案（状态提示/toast/确认框/更新检查等）现在会自动重译，不必重开面板（MutationObserver）
- 修复英文切回中文时部分文本回不去的问题：区分「应用改写了文本」与「引擎自己写入的值」
- 补精确词条 16 条 + 片段规则约 145 条：工具箱状态、更新检查、ZeroTier/Ollama/llama.cpp/公网隧道/备份/插件等动态文案
- 独立对话助手窗口（chat.html）接入同一引擎；界面语言切换会广播到常驻窗口，无需重开
- 主进程界面接入同一份字典：托盘菜单、原生对话框、文件选择器、系统通知（新增 t() 帮助函数）
- 实测：界面 237 条文案在英文模式下仅剩 2 条提取伪影；中英往返 0 处不一致；ui:check 全绿
- 说明：终端日志、导出的日志/便携包文件内容、发给模型的提示词不翻译

## v1.31.1 (2026-09-13) — 修复与检查
- 修复英文模式下 3 处中文残留：语言下拉的「简体中文」、工具箱「全部展开」/「全部折叠」
- 整理 CHANGELOG 顶部多余空行

## v1.31.0 (2026-08-22) — 工具箱插件系统
- 新增声明式工具箱插件：把 .json 放进 shell-tools 目录即可扩展工具箱，无需改套壳代码
- 新增「🧩 插件工具」分组 + 「打开插件目录」按钮，目录首次自动创建并写入 README
- 支持 5 种插件类型：command（执行命令并显示输出）/ url（浏览器打开）/ openPath（资源管理器打开）/ copy（复制文本）/ info（显示文本）
- 单命令 60 秒超时、输出上限 1MB，只读取该目录下的 .json
- 新增文档 docs/toolbox-plugins.md
- 插件分组同步支持中英切换（🧩 Plugins / Open plugins folder）

## v1.30.0 (2026-08-22) — 界面中英双语 (i18n)
- 新增「界面语言」设置：跟随系统 / 简体中文 / English，切换即时生效并保存
- 新增 i18n.js 英文字典（180 条），覆盖设置页、工具箱、面板标题、按钮、选项、占位符与 title
- 运行时按文本整体替换并可无损切回中文，不修改任何页面结构
- 原生输入弹窗（prompt）跟随界面语言显示 OK / 取消
- i18n.js 加入完整版与轻量版打包文件列表

## v1.29.0 (2026-08-22) — 缩放合并 + 本体自检 + GPU 模式 + 工具箱卡片
- 移除套壳「ST 界面缩放」注入，字号统一由 ST 本体 Data/_css/user.css 控制，避免双重缩放
- 新增 ST 本体自检：启动时自动修复被 ST 更新还原的 font_scale 上限（1.5 → 2.0），并确保 user.css 基础字号覆盖存在
- 新增「GPU 模式」设置：高性能 / 均衡 / 低显存（重启生效）；低显存 = 软件渲染，均衡 = swiftshader + 关闭 GPU 光栅/合成
- 启动提速：工具箱改为首次打开时懒加载初始化
- 工具箱卡片化 + 结果抽屉样式
- GitHub Actions 增加 npm run ui:check 快照回归步骤
- 启动时立即执行一次自动备份检查

## v1.28.0 (2026-08-22) — 修复原生输入弹窗 + 仓库清理
- 修复 prompt.html / prompt-preload.js 为 0 字节导致 ST 的 prompt() 弹窗空白且永不返回结果的问题
- 修复 webview-preload.js 在 type:module 下被当作 ESM 加载、require 报错导致 webview 增强（缩放上报/右键菜单/快捷键/原生弹窗桥）全部失效的问题，改为 ESM import
- 清理旧完整版产物 dist-electron-v3 与 staging 构建缓存
- 清理 scripts/ 下 32 个一次性测试脚本，只保留构建与检查所需脚本

## v1.27.4 (2026-08-22) — ST 本体字号修正配套
