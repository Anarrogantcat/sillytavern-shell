# SillyTavern Desktop Shell 更新日志


















## v1.28.0 (2026-08-22) — 修复原生输入弹窗 + 仓库清理
- 修复 prompt.html / prompt-preload.js 为 0 字节导致 ST 的 prompt() 弹窗空白且永不返回结果的问题
- 修复 webview-preload.js 在 type:module 下被当作 ESM 加载、require 报错导致 webview 增强（缩放上报/右键菜单/快捷键/原生弹窗桥）全部失效的问题，改为 ESM import
- 清理旧完整版产物 dist-electron-v3 与 staging 构建缓存
- 清理 scripts/ 下 32 个一次性测试脚本，只保留构建与检查所需脚本

## v1.27.4 (2026-08-22) — ST 本体字号修正配套
