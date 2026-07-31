# SillyTavern Desktop Shell

SillyTavern Electron 桌面套壳 — 无边框窗口、系统托盘、终端面板、Ctrl+滚轮缩放、Git 安装/更新。

## 功能

- 无边框窗口 + 自定义标题栏
- 系统托盘（关闭→隐藏，右键退出）
- 内置终端面板（实时日志 + 命令执行）
- Ctrl+滚轮缩放
- 首次启动自动 git clone 安装 SillyTavern
- ST 自动更新（git pull）
- 套壳自动更新（electron-updater）
- SillyTavern 完整性检测
- 悬浮按钮 + 折叠隐藏
- 用户数据保护（卸载时可选清除）
- 关闭行为设置（询问/托盘/退出）

## 版本

- **轻量版 NSIS 安装包**: 自定义路径，首次启动自动下载 ST
- **便携版**: 直接解压覆盖，保留 resources/sillytavern
- **完整版**: 内置 SillyTavern，适合离线使用
