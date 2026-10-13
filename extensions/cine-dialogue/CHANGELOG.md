# 分镜对话 Cine Dialogue · 更新日志

## v0.1.0 (2026-10-13) — 首次发布：核心渲染（L1）

### 新增
- `logic.js` 纯逻辑层（不碰 DOM / ST，可在 Node 里跑夹具）
  - 契约解析：`名字·层 内容`（层后**强制一个空格**）/ `旁白·内容` / `[FRONTEND]` / `[OPTIONS]`
  - 五层：台词 / 动作 / 感官 / 心理 / 旁白
  - **颜色 = 角色**：按出现顺序分配，超出 8 色走黄金角 HSL；给 seed 则稳定不变
  - **一条消息一个网格** → 名字列宽整条统一
  - 格式错的行 **显式标红**（不静默降级成旁白）
- `style.css`：全部选择器 `cd-` 前缀，**不含任何全局选择器**（AGENTS §0.3.2）
  - 动作实线 3px / 感官点线 3px / **心理双线 3px + 斜体** / 台词无标记 / 旁白灰
  - 亮色主题由 `.cd-light` 类切换（不选 `:root`）
  - 窄屏媒体查询（选择器仍限 `cd-`）
- `index.js` 挂载层
  - **8 个触发点**：`CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` / `GENERATION_ENDED` /
    `MESSAGE_UPDATED` / `MESSAGE_EDITED` / `MESSAGE_SWIPED` / `CHAT_CHANGED` / `MORE_MESSAGES_LOADED`
  - **流式安全**：流式中 `.mes_text` 被逐 token 重写 → 不处理，等 `GENERATION_ENDED`
  - **幂等**：每次都从 `chat[mesid].mes` 原文重算，不缓存 DOM
  - **只替换「100% 是我们的行」的 DOM 块**；其余节点（前端 iframe / 思考块 / 状态栏）原样保留
  - 整楼名字列宽统一（多个块时量取最大后固定）
  - 首行缩进只给「真的换行」的段落；**台词永不缩进**
- 适配层（探测 + 降级，不硬依赖）
  - **酒馆助手** `TavernHelper.getChatMessages` 取原文 → 无则退回 `getContext().chat[id].mes`
  - **MVU** `Mvu` 探测（本版只报状态，阶段 7 才读 `stat_data`）
  - **卡兼容助手** `CardCompat`（0.33.0）：只读 `version/protocol/compatMode/mvu`；不改它
- 对外 API：`CineDialogue.config / setConfig / colors / refreshAll / render / stats`
- `loading_order: 110` —— 排在 酒馆助手(100) / card-compat(30) / plot-pilot(40) **之后**

### 与 card-compat 的时序适配（实测依据）
- 它 `GENERATION_ENDED` 后有 **2500ms / 7000ms** 延迟动作、`CHARACTER_MESSAGE_RENDERED` 后有 **1500ms** `checkFrontBlocks`
- 这些动作若重渲染会冲掉我们的 DOM → 我们在生成结束后 **补跑 200 / 1600 / 2700 / 7300 ms** 四次

### 已知限制（下一阶段处理）
- `[FRONTEND]` 段落目前**原样保留**（不重排），若前端不在消息末尾，顺序不会被调整
- 一个块里**混着**我们的行和别的内容（如行内 `<tucao>`）时，**整块跳过**（宁可不渲染，不破坏别人的 HTML）
- 设置面板 / 逐卡配置 / 卡内嵌脚本沙箱 / 选项发送通道 → 见方案的 L2 / L5 / L6 / L8
