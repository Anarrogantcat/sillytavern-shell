# SillyTavern Desktop Shell 更新日志


## v1.8.16 (2026-08-21) — 安全与功能修复
- 🔴 P0 路径删除保护补全：isUnsafeRmPath 改为双向判定（目标在受保护目录内 / 受保护目录在目标内均拒绝），并把 Data 目录纳入保护；settings:save 与 CLI --server-path 复用同一校验，封堵设置面板绕过校验的入口
- 🔴 修复 窗口状态永不恢复：loadWindowState 在 ESM 主进程里误用 require('electron') → 改为 import { screen }，显示器边界校验恢复
- 修复 NSIS 默认安装路径双重拼入 SillyTavern（...\SillyTavern\SillyTavern\Shell）→ 目录名已是 SillyTavern 时仅追加 \Shell
- 修复 回滚按钮 / Ollama 加载卸载按钮渲染为纯文本且不可点击：新增 setDetailHtml 用于可信 HTML，setDetail 继续用于纯文本转义
- 修复 终端面板拖拽调高方向反了（bottom 固定、顶部手柄，改为 startH - dh）
- 修复 独立对话窗口会话标题未转义直接 innerHTML 的注入风险
- 修复 sessionSave 缺少路径穿越校验（与 sessionLoad/sessionDelete 对齐）
- 修复 半成品 ST 安装被判定为已安装：isSillyTavernInstalled 同时检查 server.js 与 node_modules，git clone 成功但 npm install 失败时下次启动会重新安装
- 修复 Gemini 模型直连 URL 重复拼接 /v1beta；模型服务状态增加 Gemini 分支；Claude 可达性改用 r.ok/r.status<500
- 修复 完整性检测脚本 split('\\\\n') 过度转义导致 git ls-files 多行输出不拆分
- 修复 zTXt 角色卡解析在 ESM 中误用 require('node:zlib')，并跳过压缩方式字节
- 修复 自动备份开启后因未填备份目录导致定时备份永不执行
- 修复 PIN 设置反馈写到 input 元素不显示（改为状态 span）
- 修复 启动加载日志不剥离 ANSI 转义码；终端输出区加 tabindex 使 Ctrl+C 复制可用
- 修复 ELECTRON_RUN_AS_NODE: undefined 可能被传成字符串 "undefined"（改为删除该键）
- 开发模式 defaultST 由盘符根改为 ../SillyTavern；dev guard 收窄到项目根
- 同步 package-lock 版本号 1.8.16

## v1.8.15 (2026-08-17) — Cloudflare 公网隧道
- 新增 🌐 公网隧道（Cloudflare Tunnel，开源免费免注册）：cloudflared 二进制随安装包分发（构建时自动下载到 vendor/，打包进 resources/）；设置面板一键开关；生成 trycloudflare.com 公网地址 + 复制按钮；手机 4G 即可访问
- 安全：开启隧道必须已设置访问密码（basicAuth）；未开认证时自动启用并重启服务器；关闭即地址失效

## v1.8.14 (2026-08-04) — 安全审计修复
- 🔴 P0 路径删除保护：禁止删除盘符根/系统根/主目录/套壳自身/项目根（开发模式 defaultST 曾指向 D:\，设置服务器路径也可指向任意目录→清空）；设置危险服务器路径直接拒绝
- 🔴 修复 独立对话助手完全不可用：chat.html 调顶层 API，preload 只在 tools 下 → 补顶层扁平别名；chat 窗口补 sandbox:false（ESM preload 必需）
- 🔴 XSS→RCE 修复：setDetail 全部转义为纯文本；版本号/文件列表/角色卡名 innerHTML 转义；CSP 去掉 script-src 'unsafe-inline'；window.open 改 openExternal；主进程 setWindowOpenHandler deny（防子窗口继承 preload）
- 🔴 局域网 basicAuth 修复：ST 1.18 不读 --basicAuthUser CLI 参数 → 改为环境变量注入（SILLYTAVERN_BASICAUTHMODE/USERNAME/PASSWORD，getConfigValue 优先读 env，零写入 ST）；login 应答仅限本地地址（防凭据泄露给任意站点）
- 修复 完整版 ST 更新失败：无 .git 时明确提示走套壳更新
- 修复 lite 版误打包 ST（93MB）：afterPack 检测 lite 输出跳过；lite 更新通道分离（latest-lite.yml）
- 修复 版本回滚从未生效：installerPath 从 downloadedUpdateHelper（无此属性）改为 autoUpdater.installerPath；回滚安装前退出应用
- 修复 备份 zip 命令注入（路径拼 PowerShell 命令 → 参数数组 spawn）；备份排除规则支持 Windows 反斜杠
- 修复 ST 崩溃无感知：异常退出通知页面 + 自动重启（5 分钟最多 2 次防循环）
- 修复 窗口恢复到屏幕外（显示器边界校验）
- 修复 统计口径（chars 实为聊天文件数）；ST/套壳更新按钮错位（update-section 多区块）；PIN 状态不显示（password input 加状态 span）；RAG 路径提示缺分隔符
- 修复 路径穿越：角色卡名/会话 id 拒绝 .. 与绝对路径
- 修复 云模型直连无鉴权：Claude（/v1/messages+x-api-key）、Gemini（generateContent+key）、OpenAI 兼容（Bearer）
- 修复 全量检查脚本误报（动态 id/IPC on 通道）；package-lock 版本同步 1.8.13

## v1.8.13 (2026-08-04)
- 🔴 修复 聊天无法保存：v1.8.12 增量读取驻留文件句柄，Windows 上阻止 ST 保存聊天的临时文件重命名 → 改为 open→read→close（不驻留句柄，仍增量读取）
- 🔴 修复 角色卡速览仍无法解析：PNG 签名检查用 toString('ascii') 比较 0x89 被截断成 tab 导致所有卡片被拒 → 改为字节级比较；ST 1.18 角色卡 JSON 为 Base64 编码 → 增加 Base64 解码通道（39 张真实角色卡全部解析通过）
- 卡顿：驻留句柄导致 ST 保存失败重试也是卡顿来源之一，随聊天保存修复一并消除（保留 mtime 缓存 + tokenize 3s 超时）

## v1.8.12 (2026-08-04)
- 性能优化（聊天统计 watcher）：① 聊天文件改为增量读取（保持句柄只读新增字节，不再每 10 秒全量读大文件）；② mtime 缓存（每轮只 stat 新文件，不再全量 stat 排序）；③ Token 统计请求超时 15s→3s（避免与 ST 生成争抢 Ollama 队列拖慢生成）

## v1.8.11 (2026-08-04)
- 修复 ST 本体插件/扩展更新失败 "Internal Server Error"：根因 = 重装系统后用户扩展目录（Data/default-user/extensions/*）git 仓库报 dubious ownership，git pull 失败 → ST 返回 500；启动时自动把扩展目录加入 git safe.directory（幂等，与 ST 本体同款处理）

## v1.8.10 (2026-08-04)
- 修复 角色卡速览识别不了角色卡：PNG 解析改为按 chunk 结构正确读取 tEXt（关键字 chara/ccv3），不再全文搜字节（旧实现大 JSON 截断/误匹配）
- 修复 迷你状态窗不显示：清除 v1.8.8 及以前 × 按钮遗留的 localStorage 隐藏标记；启动即显示"就绪"空闲状态（之前要等聊天事件才出现）

## v1.8.9 (2026-08-04)
- 新增 迷你状态窗可拖动（按住拖到任意位置，位置记忆，重启保留；× 仍可临时隐藏）

## v1.8.8 (2026-08-04) — v1.8.7 问题修复
- 修复 模型服务状态（A3）读取配置失败：registerEnvTools 缺 dataRoot 传参
- 修复 独立对话多会话（B10）崩溃：registerChatTools 缺 app 传参（app.getPath 抛错）
- 修复 局域网开启密码后本机 webview 被 basicAuth 挡住（401）：session login 事件自动应答凭据，手机端仍手动输入
- 修复 局域网密码泄露到终端日志：显示 ******
- 修复 环境体检按钮在 v1.8.7 工具箱改造中被误删：已加回
- 修复 主题/字体/迷你窗设置重启后不生效：启动时即应用 UI 设置
- 修复 窗口置顶设置重启后不生效：createWindow 时应用
- 修复 迷你状态窗 × 按钮与设置开关状态不同步：× 仅临时隐藏本次，重启恢复；设置开关为持久控制
- 修复 全局快捷键在 ST 页面内不生效：webview-preload 转发 Ctrl+Shift+T/R/L
- 修复 detectModel 缺 claude/gemini 来源（独立对话/草稿在云 API 配置下不可用）

## v1.8.7 (2026-08-04) — 全面增强版
- A1 局域网访问：设置面板开关 + 用户名/密码（--listen + basicAuth 启动参数，零写入 ST），显示手机访问地址
- A2 迷你状态窗：右上角胶囊显示生成中🟡/完成✓(耗时+Token)/空闲；设置开关 + ×按钮 + 托盘联动隐藏
- A3 模型服务状态（三层适配）：Ollama 原生 API（在线/加载模型/显存）；其他本地部署（LM Studio/Aphrodite/llama.cpp/vLLM 等）OpenAI 兼容探测；云 API 端点探测；失败降级
- B1 全局快捷键：Ctrl+Shift+T 工具箱 / Ctrl+Shift+R 刷新 / Ctrl+Shift+L 设置
- B2 窗口置顶开关（设置面板）
- B3 界面主题：深紫/深蓝/纯黑
- B4 UI 字体大小：90%/100%/110%
- B5 聊天导出 HTML（阅读器样式，存套壳 exports 目录）
- B6 角色卡速览（解析 PNG 内嵌 JSON：描述/性格/场景/开场白）
- B7 世界书查看（条目浏览）
- B8 备份增强：zip 压缩 + 手动备注名
- B9 模型快捷加载/卸载（工具箱，直连 Ollama）
- B10 独立对话多会话（持久化到套壳 userData，会话列表/新建/删除）
- B11 本地知识库 RAG：rag-docs 目录（txt/md/json）关键词检索，独立对话自动引用
- B12 启动加速：safe.directory 检查异步化（不再阻塞启动）
- B13 异常退出提示（干净退出标记 + 启动检测，可关）

## v1.8.6 (2026-08-03)
- 移除 ⚡ 模型测速面板（用户判定多余，聊天统计可顶替）：删除测速按钮/面板/主动测速与建议逻辑；保留底层自动统计（对话 Token 记录与生成完成通知），watcher 启动时自动初始化模型配置

## v1.8.5 (2026-08-03)
- 新增 右键菜单：ST 页面内右键 → 复制/粘贴/全选/刷新/返回/前进/放大/缩小/重置缩放/检查元素；套壳界面右键（标题栏/面板/空白处）→ 设置/工具箱/终端/刷新/检查更新/退出

## v1.8.4 (2026-08-03)
- 修复 🧰 工具箱默认打开且按钮无效：隐藏规则从 `#bench-panel.hidden`（仅按 id 匹配）改为通用 `.bench-panel.hidden`（同时覆盖测速/工具箱面板）；面板基础样式改为共享类
- 修复 沉浸模式（F11/按钮）打开后关不掉：`immerseSet` 改为 toggle 语义（`setFullScreen(!isFullScreen)`），F11 与按钮均可开可关

## v1.8.3 (2026-08-03)
- 修复 🧰 工具箱面板打不开的根因：tools-panel 缺少 position:fixed，导致面板渲染到屏幕左上角（被忽略）而非右下角；与测速面板同款定位修复

## v1.8.2 (2026-08-03)
- 调整 自动备份开关/频率/保留份数、开机自启、深夜模式、PIN 锁、生成通知、版本回滚移到 ⚙ 设置面板（工具设置区）；🧰 工具箱只保留操作类功能（立即备份/搜索/统计/导出/环境/草稿/独立对话/沉浸）
- 修复 立即备份结果在工具箱内显示

## v1.8.1 (2026-08-03)
- 改进 自动备份改为明确开关（开关切换开/关），频率（24/48/72h）独立下拉设置，互不干扰

## v1.8.0 (2026-08-03) — 工具箱大版本
- 新增 🧰 工具箱面板（右下角按钮，可隐藏），17 项功能全部零依赖 ST 本体（ST 更新无感）：
- A 档（套壳自身）：
  - A1 数据自动备份：一键备份 Data 到指定目录（默认 E:\SillyTavernBackup），定时自动（24/48/72h）+ 保留份数管理
  - A2 版本回滚：每次更新自动保留旧安装包，工具箱一键回滚
  - A3 沉浸模式（F11 全屏）/ 深夜模式（22:00-07:00 自动暖色）/ PIN 锁屏
  - A4 托盘增强：立即备份 + 打开数据/角色卡/ST/Ollama 目录
  - A5 开机自启开关
  - A6 便携模式：一键导出数据到移动盘并生成说明
- B 档（只读数据）：
  - B7 聊天全文搜索：跨全部角色卡搜关键词
  - B8 剧情总结：直连当前模型总结最新聊天并导出 md
  - B9 生成完成通知：新回复生成完成弹系统通知（10s 节流，可关）
  - B10 角色卡批量导出
  - B11 聊天统计：角色卡/消息数/字数/回复量
- C 档（外部环境）：
  - C12 一键环境体检：Git/Node/Ollama/ST 端口/磁盘/Clash/火绒
  - C13 Ollama 模型面板：列表/大小/量化/加载状态/加载卸载
  - C14 显存温度监控（nvidia-smi）
  - C15 Clash 代理状态检测
- D 档（模型直连）：
  - D16 独立对话助手：独立窗口直连模型（不经过 ST）
  - D17 草稿生成器：直连模型生成文本，一键复制

## v1.7.1 (2026-08-03)
- 修复 测速面板打开时主进程卡顿/无响应：硬件检测原用 execSync 同步执行 nvidia-smi/powershell（最多阻塞 13 秒）→ 改为异步检测，面板打开 <0.5s 响应，硬件信息后台填充后自动刷新
- 修复 切换角色卡后测速面板不跟随：watcher 由 fs.watch 改为 10 秒轮询扫描，自动检测角色卡变化（切换后重置统计）、新聊天文件（重写文件自动重置基线）、不再丢事件
- 面板打开时立即扫描最新聊天状态（无需等轮询）

## v1.7.0 (2026-08-02)
- 新增 模型生成速度检测（右下角 ⚡ 按钮，可隐藏）
  - 实测当前模型生成速度：本地 Ollama 用 `/api/generate` 精确计量（3 次取中位数），远程 API 走 chat/completions 估算
  - 自动识别当前角色卡（active_character），只读聊天记录
  - 自动记录 3 次对话（监听聊天文件增量，10 分钟窗口分组；每次记录总 Token 与角色卡回复 Token，Ollama 用模型真实 tokenizer 精确统计）
  - 结合电脑配置（nvidia-smi 显存 / 内存 / CPU）给出建议：
    - 建议上下文长度 = min(对话需求×1.25, 模型上限×75%, 显存KV预算)
    - 建议最大回复长度 = min(最高回复×1.1, tok/s×60s, 上下文÷8)
  - 显示完整推导过程，一键复制建议，由用户自行填入 ST 本体
  - 零写入 ST：只读 settings.json / 聊天记录，不依赖 ST 内部 API，ST 更新不受影响

## v1.6.9 (2026-08-02)
- 修复 完整性检查报错：系统重装后（新用户 SID）git 拒绝访问旧属主目录（dubious ownership）→ 完整性脚本 git 命令崩溃
  - 启动时自动把 ST 目录加入 `git safe.directory`（幂等，仅当目录是 git 仓库）
  - 完整性脚本 git 检查失败时容错：回退文件存在性检查，不再整个报错
- 修复 终端拖拽上限硬编码 600px：窗口较矮时会把 webview 挤成负高度
  - 上限动态计算：`min(600, 窗口高 - 130)`，保证 webview 至少 80px
  - 窗口 resize 时自动重新 clamp

## v1.6.8 (2026-08-02)
- 修复 套壳更新安装到错误位置：electron-updater 默认不设置 installDirectory，NSIS 安装器会回退到默认路径（`%LOCALAPPDATA%\Programs\...`），导致更新装到 C 盘而非原安装目录 — 显式固定 `autoUpdater.installDirectory = 当前 exe 目录`，更新自动装回原位
- 修复 更新安装弹出向导需手动点击：`quitAndInstall()` 默认非静默 — 改为 `quitAndInstall(true, true)`（静默安装 + 装完自动启动应用）
- 实测：`/S /D=D:\AI\SillyTavern\Shell` 静默安装退出码 0，Shell/ST/Data 三兄弟结构完整，数据保留

## v1.6.7 (2026-08-02)
- 修复 套壳更新"下载完不安装"：electron-updater 默认 logger 写 stdout，在管道已断的环境（GUI 启动器/重定向）会抛 EPIPE → Uncaught Exception → 主进程崩溃，下载完成后永远走不到安装步骤
  - stdout/stderr 增加 error 监听（EPIPE 不再导致崩溃）
  - autoUpdater 日志改接终端面板（`[updater]` 前缀，可诊断），不再写 stdout
- 新增 更新链路测试脚本：`test-upd-server.cjs`（本地 generic 更新服务器）+ `test-updater.cjs` / `test-updater-github.cjs`（真实 GitHub provider 全链路：check→下载 201MB→update-downloaded 事件已验证）

## v1.6.6 (2026-08-02)
- 新增 终端面板高度鼠标拖拽调整（面板顶部手柄，120~600px，实时联动 webview 尺寸，高度自动记忆）

## v1.6.5 (2026-08-02)
- 新增 构建前自动清理机制（`scripts/clean-build.mjs`）：构建前删除旧产物/旧缓存（staging、dist-*、旧安装包），`build:full` / `build:lite` 各自只清理自己的产物目录，双版本可顺序构建共存
- 修复 仓库 README 重复问题：完整内容合并进 README.md（GitHub 默认展示），删除冗余的 README-gh.md

## v1.6.4 (2026-08-02)
- 新增 套壳更新下载进度条（百分比 + 进度条可视化，复用 ST 更新样式；下载完成/失败自动隐藏）
- 新增 关闭到托盘时的系统通知（明确提示进程仍在后台运行、如何恢复/退出，避免误解"关闭=退出"）

## v1.6.3 (2026-08-02)
- 修复 服务器启动竞态：ST 快速启动时（URL 在渲染进程注册监听前输出）`server:url` 事件丢失，webview 永远空白 — 新增 `server:getUrl` 拉取接口，渲染进程启动时主动补拉一次（实测发现：假服务器 100ms 启动即触发）
- 新增 `scripts/smoke-test.cjs` 可复用 GUI 冒烟测试（CDP 驱动：页面/缩放/终端/ANSI 13 项断言）

## v1.6.2 (2026-08-02)
- 重做 缩放：`body.style.zoom`（只缩放内容、不重排布局）→ `webview.setZoomFactor()` 视口级缩放（与浏览器 Ctrl+滚轮一致，整个页面+UI 重排）；新增 Ctrl+0 重置、Ctrl+± 缩放、右下角缩放百分比指示；webview-preload 上报滚轮事件（节流 80ms）
- 修复 终端卡顿/卡死：`innerHTML +=` 全量重建 DOM（ST 日志刷屏时 O(n²) 冻结）→ 60ms 节流批量追加 textContent 节点，DOM 节点上限 800
- 修复 终端历史无上限增长（内存泄漏）— 渲染端 termHistory 上限 2MB
- 修复 首次安装日志 `textContent +=` 全量拼接卡 UI — 改为 80ms 节流追加
- 修复 ANSI 剥离只去颜色码（回车进度条/光标序列残留乱码）— 完整 CSI/OSC 序列剥离
- 修复 主进程终端日志高频 IPC 刷屏 — 80ms 窗口合并发送

## v1.6.1 (2026-08-02)
- 修复 完整版构建路径缺陷：prebuild.js 的 ROOT 硬编码 `../../..` 在仓库独立布局下会解析到盘根（灾难性复制整盘）— 改为 `--st-root` 参数 / `ST_ROOT` 环境变量 / 兄弟目录自动探测，并强制校验 server.js 存在
- 修复 构建产物输出到仓库外（`../../dist-*` 会落到 D:\ 根）— 改为仓库内 `dist-electron-v3` / `dist-electron-v3-lite`（已被 .gitignore 覆盖）
- 修复 完整版 artifactName 缺失导致 latest.yml url（连字符）与实际安装包名（空格）不一致，自动更新会 404 — 显式指定 `SillyTavern-Setup-${version}.exe`（lite 版同步修正）
- 新增 prebuild.js 启动时打印 ST 源码根路径

## v1.6.0 (2026-08-02)
- 修复 点击外部链接崩溃（ESM 模块中 require('electron') 未定义）— 外链打开功能真正生效
- 修复 关闭行为选"最小化到托盘"后重启被强制重置为"首次询问"
- 修复 ST 更新失败后服务器停止且不再重启（git pull/npm install 出错也会恢复服务器）
- 修复 服务器启动超时后进程未清理，下次启动端口冲突
- 修复 窗口重建时 IPC 重复注册报错
- 修复 webview 导航拦截在地址为空时异常（改为基于当前实际 URL）
- 新增 设置面板"服务器控制"区：重启服务器 / 打开 ST 目录 / 打开数据目录
- 新增 保存服务器路径后提示"重启套壳后生效"
- 改进 设置面板套壳版本动态显示（不再写死版本号）

## v1.5.5 (2026-07-31)
- 改进 打开设置面板自动检查套壳更新（无需手动点按钮）

## v1.5.4 (2026-07-31)
- 修复 预发布版本号导致 1.5.3 用户收不到更新（semver: 1.5.3-c < 1.5.3）— 正式版 1.5.4 覆盖所有用户

## v1.5.3-c (2026-07-31)
- 修复 终端面板悬空导致输入框下大片空白 — 面板贴底，webview 缩进对齐
- 修复 终端打开时悬浮按钮重叠

## v1.5.3-b (2026-07-31)
- 修复 下载报 "Please check update first" — 主进程状态机，不再依赖 electron-updater 内部状态
- 新增 网络错误自动识别（断网/代理问题给出明确中文提示）

## v1.5.3-a (2026-07-31)
- 修复 套壳更新误报旧版本（semver 严格比较，只有 remote > current 才提示）
- 修复 完整性检测误报（统一 node 脚本，显示详细错误）
- 修复 v1.5.3 release 缺 latest.yml 导致更新源异常

## v1.5.3 (2026-07-31)
- 修复 完整性检测在非 git 安装（完整版）下报错
- 新增 ST 内外部链接用系统浏览器打开（之前全被拦截）

## v1.5.2 (2026-07-31)
- 修复 完整版误打包 config.yaml（含 listen:true 等用户配置，安全隐患）— 改为首次启动生成默认配置

## v1.5.1 (2026-07-31)
- 改进 ST 更新：git pull 加 --rebase --autostash（对齐官方冲突处理方案）

## v1.5.0 (2026-07-31)
- 重构 目录结构：套壳装主目录\Shell，ST 本体在兄弟目录，更新/卸载永不触碰
- 移除 NSIS 备份/恢复机制（不再需要）
- 新增 卸载 checkbox 勾选是否删除 ST 本体和数据
- 兼容 旧版升级自动迁移路径

## v1.4.6 (2026-07-31)
- 新增 用户数据迁移到安装目录下 Data/（--dataRoot），升级/重装不再碰数据
- 新增 设置面板显示数据路径
- 修复 卸载数据清理路径指向新 Data/

## v1.4.5 (2026-07-31)
- 修复 安装包升级时 NSIS 备份/恢复不递归 — data/、node_modules/ 子目录丢失
- 修复 打开终端时 webview 不缩小、面板遮住内容
- 修复 终端面板位置与 webview 缩进不对齐
- 修复 托盘图标 asar 路径导致打包后图标丢失
- 修复 ST 版本比较字符串坑（1.4.10 > 1.4.9）

## v1.4.4 (2026-07-31)
- 移除 设置中无用的 GitHub 仓库输入框（自动更新读 publish 配置）
- 新增 ST 更新检查 10s 超时
- 新增 audit.cjs 一键审计脚本

## v1.4.3-alpha (2026-07-31)
- 修复 套壳自动更新下载后需手动点击安装并重启
- 修复 同版本仍提示更新
- 新增 下载错误提示

## v1.4.0 (2026-07-31)
- 新增 自动更新 (electron-updater + GitHub Releases)
- 新增 便携版构建 (覆盖更新不删 ST)
- 修复 安装包更新时保留 resources/sillytavern (不重下载)
- 修复 升级时不再弹删除数据提示

## v1.3.9 (2026-07-31)
- 修复 git clone code 128 — 清理非空目录后再克隆
- 修复 EPERM 权限错误

## v1.3.8 (2026-07-31)
- 修复 轻量版非git安装检测（有 server.js 就跳过下载）

## v1.3.7 (2026-07-31)
- 重做 完整性检测 — git ls-files 全量检查排除 data/

## v1.3.6 (2026-07-31)
- 新增 SillyTavern 完整性检测（设置面板一键检查 server.js/node_modules 等）
- 修复 轻量版 appId 与完整版冲突

## v1.3.5 (2026-07-30)
- 修复 轻量版首次启动 git clone code 128（已存在非git目录/已安装时智能处理）
- 修复 构建时 npm 生命周期导致 prebuild 双重执行

## v1.3.4 (2026-07-30)
- 新增 Ctrl+滚轮缩放（0.5x~4x 范围）

## v1.3.3 (2026-07-28)
- 重做 悬浮按钮横排 + 折叠动画
- 新增 构建自动清理旧包
- 新增 卸载时用户数据备份/恢复

## v1.3.2 (2026-07-28)

## v1.3.1 (2026-07-28)
- 修复 安装目录自动追加应用名（选 D:\AI → 实际装到 D:\AI\Sillytavern）
- 修复 Windows spawn ENOENT — git/npm 加 shell:true + .cmd
- 修复 轻量版图标和自定义安装路径
- 新增 首次启动依赖检测（git/node/npm）

## v1.3.0 (2026-07-28)
- 新增 轻量版安装包 — 不内置 SillyTavern，首次启动自动 git clone
- 重构 SillyTavern 更新机制 — 从 zip 下载改为 git pull (遵循官方文档)
- 新增 悬浮按钮隐藏/显示切换
- 修复 按钮布局改为网格列（每列3个）
- 新增 套壳自更新检查

## v1.2.1 (2026-07-28)
- 修复 严重卡顿 — 移除全部 backdrop-filter 模糊效果和透明窗口，恢复纯色渲染
- 新增 套壳自更新检查（设置面板 + 可配置 GitHub 仓库）

## v1.2.0 (2026-07-28)
- 重做 半透明毛玻璃效果 — 改用 CSS backdrop-filter
- 新增 右下角刷新按钮
- 新增 旧缓存清理

## v1.1.1 (2026-07-28)
- 新增 套壳更新日志查看（设置面板内弹窗显示 CHANGELOG）
- 新增 SillyTavern 更新日志链接（检测到新版时打开 GitHub Release）
- 清理 旧构建缓存和残留安装包

## v1.1.0 (2026-07-28)
- 新增 毛玻璃窗口效果 (Acrylic)
- 新增 左下角检查更新按钮
- 修复 关闭行为首次询问不生效（IPC close→hide 绕过事件）
- 修复 终端内容初始空白（渲染器就绪前拉取历史）
- 新增 终端文本选中复制 + 📋 一键复制
- 新增 设置面板关闭行为选项（首次询问/托盘/退出）
- 新增 卸载时可选清除用户数据

## v1.0.0 (2026-07-28)
- 无边框深色窗口 + 自定义标题栏
- 系统托盘（关闭→隐藏，右键退出）
- 内置终端面板（实时日志 + 命令执行）
- 设置面板（服务器路径、窗口参数）
- SillyTavern 自动更新（GitHub Release）
- NSIS 安装包（自定义路径、桌面快捷方式）
- 窗口状态记忆（位置、大小、最大化）
- 单实例锁
- 自定义应用图标
- 禁止浏览器弹窗（--no-browserLaunchEnabled）
- Ctrl+` 切换终端
