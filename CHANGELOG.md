# SillyTavern Desktop Shell 更新日志

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
