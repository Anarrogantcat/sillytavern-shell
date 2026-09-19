# 更新日志

## [0.1.3] - 2026-09-20
### 新增
- **心跳痕迹**：加载时写入 `loadedAt / loadedVersion / runCount` 并保存到 ST 设置；每次守护记录 `lastRunAt / lastRun{id,changed,actions,card}`
  → 排查时可从 `settings.json` 直接确认「扩展是否加载、是否真的跑过、跑了什么」，不再依赖人工读面板

## [0.1.1] - 2026-09-20
### 修复
- **流式模式下完全失效**：ST 的 `saveReply({fromStreaming:true})` 会跳过 `MESSAGE_RECEIVED`，导致守护从未执行；改挂 `GENERATION_ENDED` 兜住流式生成
- 修正文本后调用 `updateMessageBlock(id, msg, {rerenderMessage:true})` 触发重渲染，保证卡片正则能作用于修正后的文本
### 变更
- 「缺锚点时补锚点」默认改为**开**（只有卡自己定义过锚点、且不在隐藏白名单里才会补）
- 新增「自检当前楼层」按钮与「未接管」计数（渲染后校验卡脚本是否真的消费了标签）

## [0.1.0] - 2026-09-20
### 新增
- 锚点守护：从角色卡的 placement=2 正则脚本自动推导锚点标签族，缺失按设置补、未闭合自动补闭合
- 数据块守护：`<UpdateVariable>` 等数据块不改内容、只在未闭合时补闭合，缺失只报警不伪造
- 数据新鲜度检测：对比连续两轮的第N天/日期/时刻/地点/天气，全程一致时提示"数据疑似未更新"
- 消息区字号：`zoom` 缩放 + 字号下限 `max(Npx,1em)`
- 设置面板：总开关、补锚点开关、闭合修复开关、新鲜度提示、缩放与字号下限滑条、最近动作日志
### 说明
- 安装位置：`data/default-user/extensions/card-compat/`；不改 ST 本体与角色卡
