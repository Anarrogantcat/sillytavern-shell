# SillyTavern Desktop Shell

SillyTavern Electron 桌面套壳 — 无边框窗口、系统托盘、终端面板、Ctrl+滚轮缩放、Git 安装/更新。

## 功能

- 无边框窗口 + 自定义标题栏
- 系统托盘（关闭→隐藏，右键退出）
- 内置终端面板（实时日志 + 命令执行）
- Ctrl+滚轮缩放（视口级，Ctrl+0 重置 / Ctrl+± 缩放 + 百分比指示）
- 首次启动自动 git clone 安装 SillyTavern
- ST 自动更新（git pull）
- 套壳自动更新（electron-updater，下载进度条可视化）
- 关闭行为设置（询问/托盘/退出；托盘时系统通知提示后台运行）
- SillyTavern 完整性检测
- 悬浮按钮 + 折叠隐藏
- 用户数据保护（卸载时可选清除）
- 目录三分离：Shell（套壳）/ SillyTavern（本体）/ Data（用户数据），更新互不干扰
- 工具箱：15 个分组合并为 **8 个**（数据与导出 / 检索与统计 / 角色卡与世界书 / 模型与本地服务 / ST 扩展与插件 / 兼容与检测 / 对话与界面 / 网络与远程访问），原有控件一个不少，组内用二级小标题区分
- ST 扩展「在线更新」通道（**扩展版本与套壳版本解耦**）：扩展改完不需要重新发整个安装包 —— 套壳从 CDN 读 `extensions/index.json` 比对版本、下载文件、逐个校验 sha1 后落地；工具箱「🧩 ST 扩展与插件」可手动检查，默认启动后自动检查一次（可在同处关掉）
- 内置 ST 扩展自动部署：安装包自带 `extensions/`（卡兼容助手 card-compat、剧情推进器 plot-pilot），
  启动时按版本同步到 `Data/default-user/extensions/`（目标缺失才装、内置版本更高才更新、从不删用户文件、不碰非内置扩展）
  → 别人装了套壳也能直接拿到这两个插件，不必手动跑 `scripts/ext-install.mjs`；托盘右键「部署/更新内置扩展」可手动触发

## 版本

- **完整版安装包**（`SillyTavern-Setup-x.y.z.exe`）：内置 SillyTavern，适合离线使用
- **轻量版安装包**（`SillyTavern-Lite-Setup-x.y.z.exe`）：体积小，首次启动自动下载 ST
- **便携版**：直接解压覆盖，保留 resources/sillytavern

## 安装结构

```
安装目录\
├── Shell\          ← 套壳本体（可升级/卸载）
├── SillyTavern\    ← ST 本体（完整版内置移出 / 轻量版首启 clone）
└── Data\           ← 用户数据（聊天记录、角色卡，永不触碰）
```

## 开发

```bash
npm install
npm run build       # 完整版（内置 ST）
npm run build:lite  # 轻量版（首启下载 ST）
npm run build:portable  # 便携版
```

构建产物输出到 `dist-electron-v3` / `dist-electron-v3-lite`（已被 .gitignore 覆盖）。发布到 GitHub Releases 后，已装用户可走套壳内自动更新。

### 版本号规则

- 单一来源：`package.json` 的 `version`（界面版本号、安装包文件名、Release 名全从它派生）
- 第三位（patch）**最多到 6**：`X.Y.0` → `X.Y.6`
- 第三位满 6 还要再改 → **第二位 +1、第三位归零**：`2.0.6` → `2.1.0`
- 第二位（minor）**最多到 36**：`X.0` … `X.36`
- 第二位已经是 36、第三位又满 6 → **第一位 +1、其余归零**：`1.36.6` → `2.0.0`、`2.36.6` → `3.0.0`
- 即每个大版 = 37 条小线（0…36）× 每条 7 个 patch（0…6）
- 完整序列：`2.0.0…2.0.6` → `2.1.0…2.1.6` → … → `2.36.0…2.36.6` → `3.0.0`（当前 `1.36.x` 走完 `1.36.6` 即进 `2.0.0`）
- 发版：提交 → `git tag vX.Y.Z` → push tag → GitHub Actions（`.github/workflows/release.yml`）自动打 lite 包并发 Release

### 扩展（extensions/）怎么更新

1. 改完扩展（含 `manifest.json` 里的 `version`）后 **必须**跑 `node scripts/ext-index.mjs` 重新生成 `extensions/index.json`（CI 会跑 `--check`，清单过期直接红）
2. 提交推送即生效：已装用户的套壳下次启动会比对清单，只有清单版本更高才下载覆盖；本地手改过的同版本扩展不会被覆盖
3. 想立刻更新：工具箱 → 🧩 ST 扩展与插件 → 「检查扩展在线更新」→ 刷新 ST 页面

## 许可证

AGPL-3.0
