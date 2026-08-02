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

## 许可证

AGPL-3.0
