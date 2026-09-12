# SillyTavern Desktop Shell 更新日志


















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
