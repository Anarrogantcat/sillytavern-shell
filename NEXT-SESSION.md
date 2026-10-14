# 交接单 · 分镜对话（cine-dialogue）· 浏览器验证轮

> **给新会话的 agent**：你没有任何上文 ✓ 这份文件是**唯一交接** ✓ 请先读完再动手。
> **给用户**：新会话里贴这一句即可 ——
> `读 D:\AI\DeepSeek Harness Workspace\sillytavern-shell\NEXT-SESSION.md，按里面的清单用浏览器验证分镜对话插件。`

---

## 0 这是什么项目（30 秒）

- 仓库：`D:\AI\DeepSeek Harness Workspace\sillytavern-shell` ✓（**改之前先读它的 `AGENTS.md`** ✓ 项目专属规则 ✓ 会自动注入 ✓）
- 产物：**三个 SillyTavern 扩展** —— `cine-dialogue`（分镜对话，本轮主角）· `card-compat` · `plot-pilot`
- 运行环境：SillyTavern **1.19.0** 在 `http://127.0.0.1:8000/` ✓（401 表示要认证 = 服务在 ✓）
- 已装目录：`D:\AI\SillyTavern\Data\default-user\extensions\<id>\` ✓（`node scripts/ext-install.mjs` 负责同步）
- **本体（ST）原则**：默认**不许改** ✗；唯一例外是 `cine-dialogue` 被用户**明文授权**（`AGENTS.md` §0.5 ✓）

## 1 现在的状态（2026-10-14 收尾）

```
扩展版本    cine-dialogue 1.9.2   card-compat 0.33.1   plot-pilot 0.2.2
提交        9e4928c（本地 = 远端 ✓ 工作区干净 ✓）
已装        8 个文件与仓库逐字节一致 ✓
预设         分镜对话（专属适配）v1.9.2.json · 分镜对话（通用版）v1.9.2.json
自检        node scripts/cine-selfcheck.mjs  ⇒ 0 项 ❌
本体兼容    node scripts/st-compat-check.mjs ⇒ 三个扩展全绿
核内补丁    patches/001-messageFormatting-hook.patch **仍在位** ✓（用户选择：等浏览器验证后再撤）
```

**本轮（1.9.x）改了什么**：
- **1.9.0** 流式边出边排版（开关在面板「性能」组 ✓ 默认关 ✓）
- **1.9.1** 修 1.8.4 弄坏的按钮布局 ⇒ 挂载优先级回到 `#cc-var-bar` → 自建 `#cd-bar` → `#native` 兜底（尺寸钉死 ✓）
- **1.9.2** 适配 ST 1.19.0 ✓ 并改用**官方 `MessageFormatter`**（`BEFORE_REGEX` / `LATE` ✓）⇒
  **核内补丁 #001 变成可选** ✓（两条路径共享接线标记 `window.__cdMessageFormattingHook` ✓ 幂等 ✓）

## 2 你的任务：用 `browser_*` 工具做**真机验证**（这是本项目一直缺的一环 ✗）

> 为什么必须做：之前所有验证都是**离线**的（夹具 + 读聊天记录）⇒ 用户多次说
> 「这个你都没测出来」✗。现在有真浏览器了 ✓ 把下面 6 项挨个跑掉。

### 2.1 打开并看有没有报错（**最关键**：ESM 链接失败会让整个扩展一行都不执行 ✗）

1. `browser_*` 打开 `http://127.0.0.1:8000/`（若出现登录/认证页 ⇒ 请**用户**在浏览器窗口里完成 ✓ 然后继续）
2. 用 `browser_execute` 跑这些探针，逐条记录结果：

```js
// ① 扩展模块有没有真的执行（这是 1.19 兼容的第一证据）
window.CineDialogue && window.CineDialogue.version          // 期望 '1.9.2'
// ② 官方 MessageFormatter 钩子挂上了没（1.9.2 新增）
window.__cdMsgHookAdded === true
// ③ 接线标记（打了核内补丁 或 官方钩子生效，都会是 true）
window.__cdMessageFormattingHook === true
// ④ 挂载入口（三个按钮的宿主）
['cd-bar', 'cc-var-bar', 'rightSendForm'].map(id => [id, !!document.getElementById(id)])
['cd-btn-rerender', 'cd-btn-diagnose', 'cd-btn-off'].map(id => !!document.getElementById(id))
// ⑤ 面板有没有渲染
!!document.querySelector('#cd-panel, .cd-panel, [id^="cd-panel"]')
// ⑥ 控制台错误（若有，逐条抄下来再判断）
```

3. ⇒ 任何一条不符 ⇒ **先看浏览器控制台**（`browser_execute` 读不到 console 时，用截图/新建 `window.onerror` 收集 ✓）⇒ 再按 `AGENTS.md` §1.4 的定位纪律（**先查自己**，禁止无对照归因 ✗）

### 2.2 截图：按钮位置与尺寸（用户上一张图就是这里坏了 ✗）

- 截图发送栏区域 ⇒ 确认三个按钮（`重渲染本楼` / `诊断本楼` / `本卡生效/不生效`）
  **没有撑大、没有压住输入框、没和官方按钮重叠** ✓
- 若仍在原生栏里显示异常 ⇒ 检查 `#cd-bar` 的父节点是谁（应为 `#cc-var-bar` ✓）

### 2.3 真机渲染：打开一张有分镜行的卡，看消息

- 找一张**普通卡**（无状态栏脚本）发一条 ⇒ 分镜行应渲染成**名字列 + 内容列** ✓ 标签**不出现**在可见文字里 ✓
- 找 `JK`（左身姿/右精力/地图那张 ✓）与 `灯火幽微`（全屏自绘 UI ✓）⇒ 卡的 UI **不能被我们弄坏** ✓
- 抽查用卡名（用户点过名的）：`JK` · `灯火幽微` · `魔法少女们的坏妈妈` · `欲妈群` · `人妻牛`

### 2.4 流式边出边排版（1.9.0）

- 面板「性能」组打开 `流式边出边排版` ✓ ⇒ 发一条 ⇒ 生成**过程中**应逐渐变成分镜形态 ✓（节流 120ms ✓）
- 关掉 ⇒ 恢复「生成完才整体变」✓
- **注意**：认不出的文本必须**原样保留**（永不丢字 ✓）

### 2.5 官方 `MessageFormatter` 是否真的接管（决定能否撤补丁 ✓）

- 上面 2.1 的 `window.__cdMessageFormattingHook === true` 就是证据之一 ✓
- **更强的验证**：临时把核内补丁撤掉（`git -C "D:\AI\SillyTavern\SillyTavern" checkout -- public/script.js` ✓）
  ⇒ **硬刷新** ST 页面 ⇒ 分镜渲染**仍然正常** ✓ ⇒ 说明官方钩子确实接管了 ✓✓
- ⇒ 验证通过后按用户选择**撤掉补丁** ✓（用户已同意"验证后再撤" ✓）
  ⇒ 回滚方式：`git -C "<ST>" apply "D:\AI\DeepSeek Harness Workspace\sillytavern-shell\patches\001-messageFormatting-hook.patch"`

### 2.6 面板开关

- 面板里应有：`卡自带的选项块原样保留` ✓（1.9.2 补的 ✓）· `带前端的卡自动让位` ✓ · `流式边出边排版` ✓
- 逐一点一遍，确认改动即时生效且**不报错** ✓

## 3 规矩（**别踩**）

1. **先读 `AGENTS.md`** ✓ —— 尤其：只改扩展时**不打 tag / 不发包** ✓；改代码**必须升版本号**（三处 ✓）
2. **不要重复问用户已决定的事** ✗ —— 用户已明确过的：默认都渲染 ✓ · `<options>` 原样留给卡 ✓ · 黑名单自己维护 ✓ · 补丁等验证后再撤 ✓
3. **改可见布局**要「最小改动 + 可一键回退」✓（1.8.4 就是在这里翻车的 ✗）
4. 每轮收尾跑：`node scripts/cine-full-test.mjs` ✓ + `node scripts/st-compat-check.mjs` ✓ + `node scripts/cine-selfcheck.mjs` ✓ + `node scripts/ext-install.mjs` ✓
5. 汇报按 `AGENTS.md` §三格式：**做了什么 / 为什么这样做 / 结果**（数据不用形容词 ✓）
6. 验证结论要**带证据**（截图、探针返回值、命令输出 ✓）—— 这是本轮存在的意义 ✓

## 4 有用的命令

```powershell
cd 'D:\AI\DeepSeek Harness Workspace\sillytavern-shell'
node scripts/cine-dialogue-test.mjs     # 夹具（801 条）
node scripts/cine-card-test.mjs         # 角色卡端到端（107 张真卡 / 271 条真消息）
node scripts/cine-full-test.mjs         # 完整套件（含预设与代码同步）
node scripts/st-compat-check.mjs        # 本体更新后的兼容性（三个扩展一起）
node scripts/cine-selfcheck.mjs         # 全面自检（版本/清单/已装/测试/本体补丁/发版闸门）
node scripts/ext-install.mjs            # 同步到已装目录
node scripts/cine-preset.mjs --clean    # 重新生成「通用版」预设（--merge-from <预设> 可并入卡前端条目）
```

## 5 相关文件

| 文件 | 作用 |
|---|---|
| `sillytavern-shell/AGENTS.md` | 项目专属规则（**必读** ✓） |
| `sillytavern-shell/patches/001-messageFormatting-hook.patch` | 核内补丁（当前在位 ✓ 可撤 ✓） |
| `sillytavern-shell/patches/README.md` | 补丁的来龙去脉 + ST 更新后怎么重做 |
| `sillytavern-shell/extensions/cine-dialogue/CHANGELOG.md` | 每个版本改了什么（含本轮全部决定 ✓） |
| `sillytavern-shell/extensions/cine-dialogue/REQUIREMENTS.md` | 需求与 UI 规格来源 |
| `sillytavern-shell/extensions/cine-dialogue/reference/ui-spec-preview.html` | **UI 规格的规范样本**（配色/分隔线/列宽以它为准 ✓） |
