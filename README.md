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
- 第二位**最多到 3**，满 3 还要再改 → **第一位 +1、其余归零**：`2.3.6` → `3.0.0`
- 完整序列：`2.0.0…2.0.6` → `2.1.0…2.1.6` → `2.2.0…2.2.6` → `2.3.0…2.3.6` → `3.0.0…`
- **当前这条线（`1.36.x`）例外**：走完 `1.36.6` 后直接进 `2.0.0`，不经过 `1.37.0`；从 `2.0.0` 起按上面三条走
- 发版：提交 → `git tag vX.Y.Z` → push tag → GitHub Actions（`.github/workflows/release.yml`）自动打 lite 包并发 Release

## 许可证

AGPL-3.0
