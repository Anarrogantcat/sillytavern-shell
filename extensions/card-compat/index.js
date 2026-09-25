// 作者：小肥鱼（DeepSeek V4 Flash）· 染喵 ｜ 许可：AGPL-3.0 ｜ 项目：https://github.com/Anarrogantcat/sillytavern-shell
// index.js — 卡兼容助手（ST 扩展）v0.11.0
// ① 锚点守护 ② 数据块守护（绝不改数据内容）③ 消息区字号 ④ 结构块 YAML 修复/严格校验
// ⑤ 未声明块清理 ⑥ 变量块兜底（静默补一次 + 写回 MVU）⑦ 路径白名单 / 多块记账 / 覆盖度趋势 ⑧ MVU 联动
// 历史：v0.2.7 的「未声明块清理」被误插进 strictCheckMessage（那里没有 res，一进入就抛错并被吞掉）
//       → 本版把它放回 guardMessage 的入口，并补上 P1/P2/P3 全部路线图条目。
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, chat, saveChatDebounced, updateMessageBlock, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, generateQuietPrompt } from '../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../scripts/popup.js';
import { buildProfile, guardText, isStale, normalizeMalformedClosings, detectForeignTags, buildTailReminder, dedupeSelfClosingAnchors, extractVarSpec, extractRequiredFields, patchCoverage, repairSmartQuotes, guardBlockYaml, strictYamlCheck, stripUndeclaredBlocks, KEEP_BLOCKS, extractUpdateBlock, extractUpdateBlocks, validatePatchBlock, buildVarFixPrompt, extractAllowedPaths, validatePatchPaths, blockPresence, parsePatchOps, normalizePath, repairYamlStructure, renderChangelogMarkdown, detectVariableProtocol, coverageByProtocol, scanCardCompatibility, anchoredViewConsuming, frontBlockVerdict, pickReminderFields, patchApplyVerdict, stableStringify, parseInitVar, applyVarOps, parseSetCommands, schemaHints, replayFloorStates, planFloorFixes, detectVarScope, stateDiffFields, diagnosisReportText, FAIL_CATS, emptyFailStreak, noteFailure, moneyFlowHint, moneyLedgerDrift, moneyCorrection, parseStatusTable, mergeStatusTable, statusTableDiff } from './logic.js';

const NAME = 'card-compat';
const REPO = 'https://github.com/Anarrogantcat/sillytavern-shell';
const VERSION = '0.23.1';
const DEFAULTS = {
    enabled: true,
    injectAnchor: true,      // 缺锚点补一个（默认开；只有卡自己定义过锚点、且不在隐藏白名单里才会补）
    anchorStyle: 'self',     // self=<Tag/>  pair=<Tag></Tag>
    repairClosure: true,
    fontZoom: 1,
    fontFloor: 0,
    notifyStale: true,
    logActions: true,
    injectPrompt: true,
    panelFont: 1.1,      // 面板字号倍率（默认 1.1；1 / 1.15 / 1.3 可选）—— 0.19.1 起默认调大，原为 1
    dedupeAnchor: true,  // 续写追加出重复的自闭合锚点时自动合并
    scanRecent: 5,       // 启动/切聊天时自动规范化最近 N 楼（0=关闭）
    fixSmartQuotes: true, // 结构块内「英文引号开头 + 中文引号结尾」自动修（实测会让 YAML 解析失败）
    quoteScalars: true,   // 结构块内未加引号、但含「: 」或「 #」的值自动加英文引号（YAML 会截断/当嵌套键）
    fixYamlStructure: true, // 结构级修复：列表项行内映射+更深兄弟键、引号后跟「, 文字」（实测会让整块解析失败）
    yamlStrict: true,      // 结构块严格 YAML 校验（用扩展自带的 assets/js-yaml.min.js，失败会报警）
    stripUndeclared: true, // 清理「本卡没声明也没人渲染」的结构块（实测：模型把世界书原文回显成 <world_setting>）
    fixBracketTags: true,  // 0.8.0：模型把尖括号写成全角方括号时改回 <Tag>（实测【NSFW_IMG> 会让插图整块不显示）
    varAuto: true,         // 0.10.0：MVU 不在时自动兜底应用变量补丁（MVU 在就完全不接管）
    varBar: true,          // 0.10.0：输入框显示「补应用变量」按钮
    varRepair: true,       // 0.11.0：检测到「补丁没生效」时自动重算全部楼层变量（幂等重放，不依赖 MVU）
    overdraftGuard: true,  // 0.12.0：收支保护 —— 某楼补丁会把金额扣成负数时，整楼 delta 不应用（只应用 replace），并提示
    schemaGuard: true,     // 0.12.1：按卡的 Zod 结构校验写入（类型/枚举/夹取/范围/prefault 默认值），不合规就跳过并记账
    autoFixVars: false,     // 模型漏输出变量块时自动补一次（静默生成，只补补丁；默认关，避免意外调用 API）
    autoFixVarsMaxChars: 6000,
    pathWarn: true,        // 补丁路径白名单校验（只提示，不改写）
    moneyCheck: true,      // 0.22.0：资金流体检 + 账目对账（关掉则完全不计算、不显示）
    moneyFix: true,        // 0.22.0：资金纠正按钮（写入前确认、可撤销）
    tableWrite: true,      // 0.23.0：本楼没有 JSONPatch 但有状态表时，允许按表写回（写前确认、可撤销）
    mvuVerify: true,       // 用 MVU 的 parseMessage 试解析本轮变量块（能提前发现「块在但解析不了」）
    toastOnFail: true,     // 连续多楼缺变量块 → 弹一次气泡
    profileTtlMs: 60000,   // 角色卡档案缓存时长（P1 ④）
    lang: 'auto',          // 面板语言 auto|zh|en（P3 ⑩）
    nudgeRender: true,     // 重渲染后补发 MESSAGE_UPDATED，让酒馆助手立刻重画前端块（见 nudgeRender()）
    rerenderOldFloors: false, // 历史楼层修正后是否也重渲染（默认否：不拆掉已经画好的状态栏面板）
    compatMode: false,     // 0.4.0 兼容模式：关掉所有跨扩展联动（补发事件 / MVU 写回 / 自动补变量），只留纯文本守护
    depCheck: true,        // 0.4.0 面板显示 ST / 酒馆助手 / MVU 的版本与可用性
};
const stats = { guarded: 0, rerendered: 0, anchorInjected: 0, closeRepaired: 0, dataMissing: 0, staleWarned: 0, unrendered: 0, foreignTags: 0, duplicatesCollapsed: 0, quotesFixed: 0, scalarsQuoted: 0, yamlIssues: 0, yamlStructFixed: 0, yamlStrictOk: 0, yamlStrictFail: 0, yamlStrictSkipped: 0, blocksStripped: 0, unclosedBlocks: 0, varFixTried: 0, varFixOk: 0, varFixApplied: 0, varFixFailed: 0, coverageTotal: 0, coverageHit: 0, pathUnknown: 0, extraPaths: 0, multiBlocks: 0, nudgeMisses: 0, formatMissing: 0, bracketFixed: 0, mvuParseOk: 0, mvuParseFail: 0, toasts: 0, varReplayRuns: 0, varReplayFloors: 0, varRepairAuto: 0, varStuck: 0, varGuard: 0, varNegFixed: 0, varSchema: 0 };
let lastCoverage = null;
let lastReport = null;            // P1 ② 面板对照表数据
const recent = [];
const covHistory = [];            // P2 ⑥ 覆盖度历史（最多 40 条）
const lastSeen = new Map();  // messageId -> 上次守护后的文本（续写会改写同一条消息，文本变了就要再守护一次）
let hardFailStreak = 0;           // P1 ③ 连续缺变量块的楼层数
// 0.16.2：把「只进日志」的几类硬失败做成可见化 —— 同类连续 3 楼才弹一次（10 分钟冷却），并记进面板
const failTrace = [];              // 最近 20 条硬失败 { t, cat, tag }
const failStreak = emptyFailStreak();   // 同类连续计数（换类别即清零），算法在 logic.js 的 noteFailure
const failAlerted = new Map();     // cat -> 上次提醒时间（防重复弹）
const strippedByFloor = new Map(); // messageId -> { tags, chars }（未声明块，供对照表按楼层显示）
let lastToastAt = 0;
let mvuExtraLogged = false;

/* ── P3 ⑩ 面板双语（zh/en），auto 跟随浏览器语言 ── */
const STRINGS = {
    zh: {
        title: '卡兼容助手', secGuard: '守护与修复', secBlocks: '结构块与变量块', secReport: '本卡要求 vs 本轮实际',
        secMvu: 'MVU 联动', secDep: '依赖与联动', secUi: '界面与诊断', enabled: '启用守护',
        secScan: '兼容性体检', scanNote: '对全部角色卡跑一遍判定：每张卡能做什么、为什么降级（本地纯计算，100 张约 0.2 秒）', scanRun: '开始体检', scanCopy: '复制报告', scanIdle: '还没体检过 —— 点「开始体检」',
    diagCopy: '复制本卡诊断', diagCopied: '本卡诊断已复制', diagFail: '复制失败（剪贴板不可用）', diagTip: '把面板里散落的事实收成一段结论：为什么这张卡不动、建议点哪个开关', scanRunning: '体检中…', scanSum: '结果', scanOf: ' 张', scanGuard: '可守护', scanWrite: '可写回', scanRules: '有规则', colCard: '角色卡', colProto: '变量协议', colCap: '锚点/数据块/规则', colVerdict: '结论', scanMore: '（只显示前 200 张，完整结果可用「复制报告」）', scanCopied: '报告已复制', scanCopyFail: '复制失败（剪贴板不可用）', v_all: '全部', v_ok: '守护+校验可用', 'v_guard-only': '只能守护（无变量块）', 'v_no-rules': '有变量块但抽不到规则', 'v_read-only': '协议只读（不能写回）', 'v_format-only': '只有格式标签（仅提醒）', 'v_helper-only': '靠酒馆助手脚本渲染', v_plain: '纯正文卡（无需处理）', 'v_dyn-bar': '动态状态栏（前端渲染）', scanDyn: '动态状态栏', scanPanel: '交互面板', scanDynYes: '动态', scanNoRules: '无规则原因', scanAlerts: '预警', 'alert_new-dialect': '疑似新方言', 'alert_disabled-views': '渲染正则关着', disViews: '被禁用的渲染正则', disAuto: '（卡自带脚本会运行时开启）', disWarn: '（不会显示）', disAlt: '（有同类启用项，属备选）', 'alert_disabled-alternative': '渲染正则（备选）', applyHint: '本轮补丁', 'apply_no-block': '没输出变量块', 'apply_no-patch': '有变量块但没有补丁操作', apply_unknown: '拿不到 stat_data，无法判断', 'apply_not-applied': '补丁没生效 → 已自动从 [InitVar] 重算各层变量；若仍不更新，点 MVU 面板「重演楼层」或刷新页面', apply_applied: '已生效 ✓', varApplyBtn: '补应用变量', varNoOps: '本轮没有变量补丁', varNoBase: '找不到变量初值（本卡没有 [InitVar] 条目）', varBasePrev: '以上一楼为基线', varBaseInit: '以 [InitVar] 为基线', varWriteFail: '写变量失败（酒馆助手不可用？）', varApplied: '变量已补应用', varMvuWarn: '会逐楼检查补丁有没有真的写进变量，只对「没生效」的楼层补应用：以 MVU 当前值为基线，已生效的楼层一律不动，delta 只加一次（幂等，可重复执行）。继续？', varReplayTitle: '只修「补丁没生效」的楼层：以 MVU 真实值为基线补应用，已生效的楼层不动', varReplayOk: '已修复没生效的楼层', varReplayNone: '所有楼层的补丁都已生效，无需修复', varReplayFloors: '层', varReplaySkipped: '层路径全落空已跳过', varRepair: '补丁没生效时自动补应用（只动没生效的楼层，不覆盖 MVU 已应用的）', varScopeMsg: '写回范围', varBusy: '变量修复正在进行中，请稍后再点', overdraftGuard: '收支保护：某楼补丁会把金额扣成负数时，整楼 delta 不应用（只应用 replace）并提示', varGuardHit: '已拦下会把数值扣成负数的 delta', varNegFixed: '修回被扣成负数的金额', schemaGuard: '变量写入按卡的 Zod 结构校验（类型 / 枚举 / 夹取 / 范围 / prefault 默认值），不合规就跳过并提示', varSchemaHit: '已拦下不符合卡的 Zod 结构的写入', varUnverified: '本卡有 {n} 处无法离线校验的约束（{kinds}）—— 本次只应用了可静态校验的部分', schemaSummary: '卡的 Zod 结构', schemaUnverifiable: '无法离线校验的约束', schemaAllCovered: '（全部可静态校验）', schClamp: '夹取', schBound: '范围', schType: '类型', schEnum: '枚举', schDefault: '默认值', schObject: '对象', schInt: '整数', schCatch: 'catch 兜底', schRound: '取整', varModeOff: '自动兜底已关', varModeMvu: 'MVU 在运行（不自动接管）', varModeFallback: '兜底引擎自动接管中', varAuto: '无 MVU 时自动兜底应用变量（MVU 在就完全不接管）', varBar: '在输入框显示「补应用变量」按钮', btnCheckFront: '检查前端块', frontNone: '这一楼没有前端块', frontHit: '前端块', frontRendered: '已渲染', frontCollapsed: '被折叠', front_ok: '全部已渲染 ✓', front_partial: '只有一部分渲染出来，建议刷新页面', front_collapse: '被酒馆助手折叠了 —— 可把「折叠代码块」设为 disabled，或点开折叠', front_unrendered: '一个都没渲染 → 刷新页面 / 切聊天再切回 / 重生成这一楼', 'rs_check-unparsed': '有 check 但没解析出', rs_command: '命令式规则', rs_paths: '只有 paths 白名单', rs_structure: '只有变量结构', rs_schema: '规则在 schema 脚本', rs_prose: '散文式规则', rs_other: '其它写法', rs_none: '世界书里没有规则', 'v_error': '解析异常',
        protocol: '变量协议', capWrite: '可写回变量', capReadonly: '只读守护（不改宿主变量）', depLoading: '读取依赖版本…', depOff: '依赖检测已关（面板开关）',
        compatNote: '兼容模式：关掉补发事件 / MVU 写回 / 自动补变量，只留纯文本守护 —— 酒馆助手或 MVU 大更新出问题时打开它',
        injectPrompt: '生成前注入结尾结构块提醒（推荐开）', injectAnchor: '缺锚点时补一个空锚点',
        repair: '未闭合自动补结束标签', stale: '数据疑似未更新时提示',
        fixQuotes: '修结构块里的引号错配（英文引号开头 + 中文引号结尾）',
        quoteScalars: '结构块里含「: 」「 #」却没加引号的值自动加引号',
        fixYamlStructure: '结构级修复 YAML：列表项写成「- 键: 值」后面兄弟键缩进更深、引号后多写了「, 文字」（会让整块解析失败）',
        yamlStrict: '结构块严格 YAML 校验（用扩展自带的 js-yaml，失败报警）',
        stripUndeclared: '清理本卡未声明的块（模型回显世界书原文 / 自创标签）',
        fixBracketTags: '把误写成全角方括号的标签改回 <Tag>（实测【NSFW_IMG> 会让插图不显示）',
        autoFixVars: '模型漏输出变量块时自动补一次（静默生成，只补补丁）',
        mvuVerify: '校验 MVU 能否解析本轮变量块', pathWarn: '校验补丁路径是否在本卡规则内（只提示，不改写）',
        toastOnFail: '连续多楼缺变量块时弹气泡提醒', btnVarfix: '立即补当前楼层变量块',
        btnYaml: '严格校验当前楼层', btnMvu: '用 MVU 解析并写回当前层', btnMvuTest: '测试 MVU 连接',
        btnCheck: '自检当前楼层', btnRefresh: '重新读取角色卡数据', panelFont: '面板字号',
        fontFollow: '跟随 ST（默认）', fontBig: '大', fontBigger: '更大', zoom: '消息区缩放', floor: '字号下限', fontWarn: '注意：这两项会覆盖「所有角色卡自己的状态栏样式」（每张卡的美化都不同）。只在你确实觉得字太小时才开；开着时状态栏可能与卡的设计不一致。默认关闭。',
        lang: '面板语言', langAuto: '自动', stats: '统计', log: '最近动作',
        noReport: '本轮还没有记录（发一条消息后这里会显示对照表）', noRequired: '本卡没有可解析的必更字段（可能是散文式规则 / 纯前端卡）', colField: '卡要求的字段', colDone: '本轮是否更新', colPending: '值的形态就是「还没内容」（未登场/未描述等），本轮不更新属正常', reportCard: '本卡', reportFloor: '第', colState: '变量是否真的变了', stateSummary: '状态核对', stChanged: '已变', stPending: '未登场/未描述', legendTitle: '符号说明：', stVersion: '版本', stFixes: '修正', stRerender: '重渲染', stAnchor: '补锚点', stClose: '补闭合', stDataMiss: '数据块缺失', stStale: '未更新告警', stDup: '重复锚点合并', stBlocks: '未声明块清理', stUnclosed: '未闭合块', stForeign: '串卡标签', stCover: '上轮覆盖', stMissing: '缺字段', stMvuFail: 'MVU 失败', stYamlStrict: 'YAML 严格失败', stWrapped: '路径包裹还原', stWrappedTip: '模型把补丁路径写成 ${/a/b} / {{/a/b}} 时会被还原成 /a/b；旧版这种 op 会整条静默跳过（数据不更新的常见原因）', stOk: '正常', lgDone: '模型本轮写了这个字段', lgDoneShort: ' 已写', lgMiss: '模型本轮没写（❌ 只说明「没写」，不代表卡不兼容）', lgMissShort: ' 没写', lgSame: '写了，但值和上一楼一样（等于没变）', lgSameShort: ' 值没变', lgStuck: '写了，但存储里的值没变（状态栏不会更新）', lgStuckShort: ' 写了没生效', lgNoBase: '本轮没写，无法核对变量', lgNoBaseShort: ' 没写·无法核对', lgPlaceholder: '值的形态就是「还没内容」（未登场/未描述等），不更新属正常', lgPlaceholderShort: ' 未登场·正常', fail_data: '连续多楼「面板数据缺失」', fail_varfix: '连续多楼「自动补变量失败」', fail_yaml: '连续多楼「结构块 YAML 解析失败」', fail_undeclared: '连续多楼出现「本卡未声明的块」', failTimes: '：已连续 {n} 楼，建议检查模型输出或卡的规则', failRow: '连续失败', moneyWarn: '资金流体检', moneyWarnBody: '正文出现 {n} 元，但本楼补丁里没有任何「现金/欠款/钱包/资产/余额」字段（{hint}）—— 钱动了吗？模型可能漏写，可在 MVU 面板补一条 replace。', moneyHintFlow: '只有支出/收入记账', moneyHintNone: '完全没写资金字段', switchTitle: '插件总开关', switchOn: '运行中', switchOff: '已停用（不守护、不修文本、不写变量）', moneyCheck: '资金流体检与对账', moneyFix: '资金纠正按钮（写入前确认、可撤销）', moneyFixOff: '资金纠正已在面板关闭', tableSwitch: '按状态表写回（本楼没给补丁时）', tableWarn: '状态表写回', tableWarnBody: '本楼没有 <JSONPatch>，但检测到 <{tag}> 状态表（{n} 处变化）—— 模型只打印了表、没给补丁，所以数据一直不动。可一键按表写回：', tableWriteBtn: '按状态表写回本楼变量', tableWriteConfirm: '将写入 {n} 处变化（写前留快照，可撤销）', tableMore: '还有 {n} 处…', tableWriteOk: '已按状态表写回 {n} 处', tableNoChange: '状态表与当前变量没有差异', tableParseFail: '状态表解析失败', tableWriteOff: '按状态表写回已在面板关闭', tableFromSwipe: '（当前文本里没有表，已从 swipe 备档里找到 —— 旧版误删的内容还在）', ledgerWarn: '资金对账不一致', ledgerWarnTail: '（模型打算写的金额与账本实际变化对不上，可能是某楼补丁被跳过、或有别的机制改过变量）', moneyFixOffer: '正文出现 {n} 元，但本楼补丁没写现金字段。按卡的规则（累计支出_X = X 收到的钱）可以补一条：', moneyFixBtn: '给 {who} 加 {delta} 现金（{path}）', moneyUndoBtn: '撤销上次修正', moneyFixNoBase: '拿不到该楼的变量基线，无法安全修正', moneyFixWriteFail: '写回失败（TavernHelper 写入接口不可用？）', moneyUndoNone: '没有可撤销的修正', moneyUndoOk: '已撤销上一次资金修正', moneyFixBadTarget: '目标字段不是数字，拒绝代写（避免把对象/文本写成数字）', moneyFixConfirm: '确认写入这条资金修正？（会立即改该楼变量，可在面板点「撤销上次修正」回退）', undeclaredRow: '本卡未声明的块（已清理）', stateStuck: '写了但没变', stateAbsent: '本轮没写', stateSame: '写的值和原来一样', stateNoBase: '拿不到 stat_data，无法核对变量', stateStuckWarn: '→ 这些字段模型写了却没写进变量，点「补应用变量」可只对这些楼层补应用（幂等，可重复点）',
        wrotePaths: '模型实际写入', unknownPaths: '不在本卡规则里的路径', extraPaths: '组内但未逐条声明的路径',
        covTrend: '覆盖度趋势', covTrendNone: '还没有覆盖度记录（发几条消息后这里会出现趋势条）', mvuNone: '没找到 MVU API（Mvu）——若本卡依赖 MVU，请确认「酒馆助手」与 MVU 脚本已加载。',
        mvuApi: 'MVU API 可用', mvuExtraOn: '检测到 MVU「额外模型解析」已开启：为避免双写，本扩展的自动补变量会让位。',
        mvuExtraOff: 'MVU「额外模型解析」未开启或无法检测。', mvuUnparsed: 'MVU 解析本轮变量块失败：',
        mvuParsed: 'MVU 能解析本轮变量块', toastNoVars: '已连续 {n} 楼没有变量更新块，状态栏可能不会更新',
        floorOff: '关闭', mvuWriteOk: '已写回 MVU 变量', mvuWriteFail: '写回失败：', refreshOK: '已重新读取角色卡数据',
        infoTitle: '扩展信息', viewLog: '查看日志', close: '关闭', logMissing: '读不到 CHANGELOG.md（扩展目录里应当有一份，重新部署即可恢复）', logOpenFail: '打开日志失败：',
        infoAuthor: '作者：小肥鱼（DeepSeek V4 Flash）· 染喵 ｜ 许可：AGPL-3.0 ｜ 项目主页：',
        infoNote: '本扩展免费使用，禁止任何形式的商业用途。它会就地修改消息里的结构块/变量块（删未声明块 / 修 YAML / 补锚点），请确认理解后再启用。',
        nudgeRender: '重渲染后补发事件：让酒馆助手立刻重画前端块（不勾 = 要手动刷新页面才看到状态栏）',
        rerenderOld: '历史楼层修正后也重渲染（会拆掉已画好的状态栏面板，默认不勾）',
    },
    en: {
        title: 'Card Compat', secGuard: 'Guard and repair', secBlocks: 'Blocks and variables', secReport: 'Card requirements vs this reply',
        secMvu: 'MVU integration', secDep: 'Dependencies and linkage', secUi: 'Interface and diagnostics', enabled: 'Enable guard',
        secScan: 'Compatibility check', scanNote: 'Runs one pass over every character card: what card-compat can do and why it degrades (pure local computation)', scanRun: 'Run check', scanCopy: 'Copy report', scanIdle: 'Not scanned yet - press Run check', scanRunning: 'Scanning...', scanSum: 'Result', scanOf: ' cards', scanGuard: 'guardable', scanWrite: 'writable', scanRules: 'with rules', colCard: 'Card', colProto: 'Protocol', colCap: 'anchor/data/rules', colVerdict: 'Verdict', scanMore: '(first 200 only; use Copy report for the full list)', scanCopied: 'Report copied', scanCopyFail: 'Copy failed (clipboard unavailable)', diagCopy: 'Copy this card diagnosis', diagCopied: 'Card diagnosis copied', diagFail: 'Copy failed (clipboard unavailable)', diagTip: 'Turns the scattered panel facts into one conclusion: why this card is not updating, and which switch to flip', v_all: 'All', v_ok: 'guard + check', 'v_guard-only': 'guard only (no variable block)', 'v_no-rules': 'variable block without rules', 'v_read-only': 'read-only protocol', 'v_format-only': 'format tags only (report)', 'v_helper-only': 'rendered by TavernHelper', v_plain: 'plain card (nothing to do)', 'v_dyn-bar': 'dynamic status bar (front-end)', scanDyn: 'Dynamic bars', scanPanel: 'Panels', scanDynYes: 'dynamic', scanNoRules: 'No-rule reasons', scanAlerts: 'Alerts', 'alert_new-dialect': 'possible new dialect', 'alert_disabled-views': 'render regexes disabled', disViews: 'Disabled render regexes', disAuto: ' (auto-enabled by card script)', disWarn: ' (will not render)', disAlt: ' (alternative, same kind enabled)', 'alert_disabled-alternative': 'render regexes (alternative)', applyHint: 'Patch this turn', 'apply_no-block': 'no variable block', 'apply_no-patch': 'block without patch ops', apply_unknown: 'stat_data unavailable', 'apply_not-applied': 'patch not applied - floors were recomputed from [InitVar] automatically; if still stale, use MVU Replay floor or reload' , apply_applied: 'applied', varApplyBtn: 'Apply vars', varNoOps: 'no variable patch on this floor', varNoBase: 'no initial variables ([InitVar] entry missing)', varBasePrev: 'base = previous floor', varBaseInit: 'base = [InitVar]', varWriteFail: 'failed to write variables (TavernHelper unavailable?)', varApplied: 'Variables applied', varMvuWarn: 'Every floor is checked: only floors whose patch never reached the variables are fixed, using MVU current state as the base. Applied floors are left untouched and delta is added once (idempotent). Continue?', varReplayTitle: 'Fix only the floors whose patch did not apply; MVU current state is the base', varReplayOk: 'Fixed the floors whose patch had not applied', varReplayNone: 'Every floor patch is already applied', varReplayFloors: 'floor(s)', varReplaySkipped: 'floor(s) skipped (all paths missed)', varRepair: 'Auto-apply patches that did not take effect (never overwrites floors MVU already applied)', varScopeMsg: 'write scope', varBusy: 'A variable repair is already running', overdraftGuard: 'Overdraft guard: when a patch would push a money value negative, that floor deltas are skipped (replace still applies) and reported', varGuardHit: 'Blocked deltas that would go negative', varNegFixed: 'Rebuilt money values that had gone negative', schemaGuard: 'Validate variable writes against the card Zod schema (types / enums / clamps / ranges / prefault defaults); skip and report what does not fit', varSchemaHit: 'Skipped writes that do not match the card Zod schema', varUnverified: 'This card has {n} constraint(s) that cannot be checked offline ({kinds}) - only the statically checkable part was applied', schemaSummary: 'Card Zod schema', schemaUnverifiable: 'constraints that cannot be checked offline', schemaAllCovered: '(all statically checkable)', schClamp: 'clamps', schBound: 'ranges', schType: 'types', schEnum: 'enums', schDefault: 'defaults', schObject: 'objects', schInt: 'ints', schCatch: 'catches', schRound: 'rounds', varModeOff: 'auto fallback off', varModeMvu: 'MVU running (no auto takeover)', varModeFallback: 'fallback engine active', varAuto: 'Auto-apply variables when MVU is absent (never touches MVU)', varBar: 'Show the apply-vars button above the input box', btnCheckFront: 'Check front-end blocks', frontNone: 'No front-end block on this floor', frontHit: 'front-end blocks', frontRendered: 'rendered', frontCollapsed: 'collapsed', front_ok: 'all rendered', front_partial: 'only some rendered - try reloading the page', front_collapse: 'collapsed by TavernHelper - set collapse_code_block to disabled or expand it', front_unrendered: 'none rendered - reload the page / switch chats / regenerate this floor', 'rs_check-unparsed': 'has check, unparsed', rs_command: 'command style', rs_paths: 'paths list only', rs_structure: 'structure only', rs_schema: 'rules in schema script', rs_prose: 'prose rules', rs_other: 'other style', rs_none: 'no rules in book',
        protocol: 'Variable protocol', capWrite: 'can write variables back', capReadonly: 'read-only guard (does not touch host variables)', depLoading: 'Reading dependency versions...', depOff: 'Dependency check is off (panel switch)',
        compatNote: 'Compat mode: disables the event nudge / MVU write-back / auto var fix, leaving pure text guarding - turn it on when TavernHelper or MVU updates break things',
        injectPrompt: 'Inject tail structure reminder before generating (recommended)', injectAnchor: 'Add an empty anchor when missing',
        repair: 'Auto-close unclosed tags', stale: 'Warn when data looks unchanged',
        fixQuotes: 'Fix mismatched quotes in blocks (ASCII opener + CJK closer)',
        quoteScalars: 'Quote plain values containing colon-space or hash',
        fixYamlStructure: 'Structural YAML repair: list item written as "- key: value" with deeper sibling keys, or extra text after a closing quote',
        yamlStrict: 'Strict YAML check of blocks (bundled js-yaml)',
        stripUndeclared: 'Strip blocks this card never declared (lorebook echo / invented tags)',
        fixBracketTags: 'Turn tags written with full-width brackets back into <Tag> (fixes missing images/panels)',
        autoFixVars: 'Silently regenerate a missing variable block once',
        mvuVerify: 'Check MVU can parse this reply variable block', pathWarn: 'Check patch paths against this card rules (report only)',
        toastOnFail: 'Toast when several replies in a row miss the variable block', btnVarfix: 'Fix variable block for current reply',
        btnYaml: 'Strict-check current reply', btnMvu: 'Parse with MVU and write back', btnMvuTest: 'Test MVU connection',
        btnCheck: 'Self-check current reply', btnRefresh: 'Reload character card data', panelFont: 'Panel font size',
        fontFollow: 'Follow ST (default)', fontBig: 'Large', fontBigger: 'Larger', zoom: 'Message zoom', floor: 'Minimum font size', fontWarn: 'Note: these two override EVERY card\'s own status-bar styling (each card is themed differently). Only turn them on if the text really is too small; while on, the status bar may disagree with the card design. Default off.',
        lang: 'Panel language', langAuto: 'Auto', stats: 'Stats', log: 'Recent actions',
        noReport: 'Nothing recorded yet (send a message to see the comparison table)', noRequired: 'This card has no parseable required fields (prose rules or front-end only)', colField: 'Required field', colDone: 'Updated this reply', colPending: 'value is a placeholder (not on stage / not described), so skipping it is expected', reportCard: 'Card', reportFloor: 'floor', colState: 'Variable actually changed', stateSummary: 'State check', stChanged: 'changed', stPending: 'placeholder (not on stage/described)', legendTitle: 'Symbols: ', stVersion: 'version', stFixes: 'fixes', stRerender: 'rerenders', stAnchor: 'anchors', stClose: 'closures', stDataMiss: 'data missing', stStale: 'stale', stDup: 'dup anchors', stBlocks: 'blocks stripped', stUnclosed: 'unclosed', stForeign: 'foreign tags', stCover: 'coverage', stMissing: 'missing', stMvuFail: 'MVU failures', stYamlStrict: 'YAML strict fails', stWrapped: 'paths unwrapped', stWrappedTip: 'patch paths written as ${/a/b} or {{/a/b}} are unwrapped to /a/b; older builds silently skipped those ops (a common cause of "data not updating")', stOk: 'OK', lgDone: 'the model wrote this field in this reply', lgDoneShort: ' written', lgMiss: 'the model did not write it this reply (means only "not written", NOT that the card is broken)', lgMissShort: ' not written', lgSame: 'written, but the value equals the previous reply', lgSameShort: ' unchanged', lgStuck: 'written, but the stored value did not change (status bar will not update)', lgStuckShort: ' written, no effect', lgNoBase: 'not written this reply, cannot verify', lgNoBaseShort: ' unverifiable', lgPlaceholder: 'the value is a placeholder (not on stage / not described), so skipping it is normal', lgPlaceholderShort: ' placeholder, normal', fail_data: 'panel data missing for several floors', fail_varfix: 'auto variable fix kept failing', fail_yaml: 'block YAML kept failing to parse', fail_undeclared: 'blocks this card never declared, again and again', failTimes: ': {n} floors in a row - check model output or the card rules', failRow: 'Failure streaks', moneyWarn: 'Money-flow check', moneyWarnBody: 'the reply mentions {n} (currency) but this floor patched no cash/debt/wallet field ({hint}) - did the money actually move? The model may have skipped it; add a replace op in the MVU panel.', moneyHintFlow: 'only expense/income counters', moneyHintNone: 'no money field at all', switchTitle: 'Master switch', switchOn: 'running', switchOff: 'disabled (no guarding / text edits / variable writes)', moneyCheck: 'Money-flow check and ledger audit', moneyFix: 'Money fix button (confirm + undo)', moneyFixOff: 'Money fix is switched off in the panel', tableSwitch: 'Write back from status table (when no patch)', tableWarn: 'Status-table write-back', tableWarnBody: 'this reply has no <JSONPatch>, but a <{tag}> table was found ({n} changes) - the model printed the table without a patch, so nothing applied. Write it back in one click:', tableWriteBtn: 'Write this reply\'s variables from the table', tableWriteConfirm: 'will write {n} changes (snapshot taken, undoable)', tableMore: '{n} more…', tableWriteOk: 'Wrote {n} changes from the status table', tableNoChange: 'the table matches current variables', tableParseFail: 'failed to parse the status table', tableWriteOff: 'status-table write-back is switched off', tableFromSwipe: '(no table in the current text; found it in the swipe backup - the old build had deleted it)', ledgerWarn: 'Money ledger mismatch', ledgerWarnTail: ' (the amount the model planned to write differs from what the ledger actually recorded - a patch may have been skipped, or something else changed the variables)', moneyFixOffer: 'the reply mentions {n} but this floor patched no cash field. Per the card rule (spend counter = money received) we can add:', moneyFixBtn: 'Give {who} +{delta} cash ({path})', moneyUndoBtn: 'Undo last fix', moneyFixNoBase: 'no variable baseline for this floor; refusing to patch blindly', moneyFixWriteFail: 'write-back failed (TavernHelper write API unavailable?)', moneyUndoNone: 'nothing to undo', moneyUndoOk: 'Last money fix undone', moneyFixBadTarget: 'target field is not a number; refusing to write', moneyFixConfirm: 'Apply this money fix? (writes the floor variables now; use Undo last fix to revert)', undeclaredRow: 'Blocks this card never declared (stripped)', stateStuck: 'written but unchanged', stateAbsent: 'not written', stateSame: 'written value is unchanged', stateNoBase: 'stat_data unavailable, cannot verify', stateStuckWarn: ' - the model wrote these but they never reached the variables; click Apply vars to fix those floors (idempotent)',
        wrotePaths: 'Paths written by the model', unknownPaths: 'Paths outside this card rules', extraPaths: 'Paths under a declared group',
        covTrend: 'Coverage trend', covTrendNone: 'No coverage history yet (send a few replies)', mvuNone: 'MVU API (Mvu) not found - if this card depends on MVU, check that TavernHelper and MVU are loaded.',
        mvuApi: 'MVU API available', mvuExtraOn: 'MVU extra model parsing is ON: auto variable fix stands down to avoid double writes.',
        mvuExtraOff: 'MVU extra model parsing is off or undetectable.', mvuUnparsed: 'MVU failed to parse this reply variable block: ',
        mvuParsed: 'MVU parsed this reply variable block', toastNoVars: '{n} replies in a row have no variable block; the status bar may not update',
        floorOff: 'off', mvuWriteOk: 'written back to MVU', mvuWriteFail: 'write back failed: ', refreshOK: 'character card data reloaded',
        infoTitle: 'Extension info', viewLog: 'View changelog', close: 'Close', logMissing: 'Cannot read CHANGELOG.md (a copy ships with the extension; redeploy to restore it)', logOpenFail: 'Cannot open changelog: ',
        infoAuthor: 'Author: 小肥鱼 (DeepSeek V4 Flash) & 染喵 | License: AGPL-3.0 | Homepage: ',
        infoNote: 'Free to use; any commercial use is prohibited. This extension edits structure/variable blocks inside messages in place (strips undeclared blocks, repairs YAML, adds anchors).',
        nudgeRender: 'Re-emit an event after re-rendering so TavernHelper redraws frontend blocks at once (unchecked = you must refresh the page to see the status bar)',
        rerenderOld: 'Also re-render historical replies after fixing them (tears down drawn status bars; off by default)',
    },
};
function langOf() {
    try {
        const s = settings();
        if (s && s.lang === 'en') return 'en';
        if (s && s.lang === 'zh') return 'zh';
        const l = (typeof navigator !== 'undefined' && navigator.language) || '';
        if (/^en/i.test(l)) return 'en';
    } catch (_) {}
    return 'zh';
}
function T(key, vars) {
    const pack = STRINGS[langOf()] || STRINGS.zh;
    let v = pack[key];
    if (v === undefined) v = STRINGS.zh[key];
    if (v === undefined) v = key;
    if (vars) v = String(v).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
    return v;
}
function escHtml(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
}
function toast(msg, type) {
    try {
        const Tt = (typeof window !== 'undefined' && window.toastr) ? window.toastr : null;
        if (Tt && typeof Tt[type || 'info'] === 'function') { Tt[type || 'info'](msg, 'Card Compat'); stats.toasts++; renderStats(); return true; }
    } catch (_) {}
    console.warn('[card-compat] ' + msg);
    return false;
}

const settings = () => extension_settings[NAME];

/* ── P1 ④ 角色卡档案缓存：同一角色 60s 内只解析一次（世界书很大时每次解析都卡） ── */
let profCache = { key: '', prof: null, at: 0 };
function invalidateProfile() { profCache = { key: '', prof: null, at: 0 }; schemaCache = null; schemaCacheKey = ''; scopeCache = null; scopeCacheKey = ''; }
/** 汇总卡的文本（正则脚本 + 酒馆助手脚本 + 世界书 + 主字段），供变量协议识别使用 */
function cardTextForProtocol(ch) {
    try {
        const d = ch?.data || ch || {};
        const parts = [];
        for (const k of ['description', 'personality', 'scenario', 'system_prompt', 'post_history_instructions', 'first_mes', 'mes_example']) {
            const v = d[k];
            if (typeof v === 'string' && v) parts.push(v.slice(0, 20000));
        }
        const ext = d.extensions || {};
        for (const s of (ext.regex_scripts || [])) parts.push(String(s.findRegex || '') + ' ' + String(s.replaceString || ''));
        const th = ext.tavern_helper || {};
        for (const s of (th.scripts || [])) parts.push(String(s.content || '').slice(0, 40000));
        const entries = (d.character_book && d.character_book.entries) || [];
        for (const e of entries) parts.push(String(e.content || '').slice(0, 20000));
        return parts.join(String.fromCharCode(10)).slice(0, 200000);
    } catch (_) { return ''; }
}
function profileOf() {
    try {
        const ctx = getContext();
        const chid = ctx?.characterId ?? ctx?.this_chid;
        const ch = ctx?.characters?.[chid];
        const key = String(chid) + '|' + String(ch?.avatar || ch?.name || '');
        const ttl = Number(settings()?.profileTtlMs) || 60000;
        if (profCache.prof && profCache.key === key && (Date.now() - profCache.at) < ttl) return profCache.prof;
        const ext = ch?.data?.extensions || ch?.extensions || {};
        const prof = buildProfile(ext);
        try {
            const book = ch?.data?.character_book || ch?.character_book;
            const entries = book?.entries || [];
            prof.varSpec = extractVarSpec(entries);
            // 0.7.0：不再截到 10 条（实测「欲妈群」有 84 条 check 规则，旧上限把覆盖度砍到只剩前 10 个字段）
    prof.required = extractRequiredFields(entries, 200);
            prof.allowed = extractAllowedPaths(entries);      // P2 ⑤ 路径白名单
            prof.bookCount = entries.length;                  // 0.16.0：诊断报告要显示世界书条目数
            // 0.19.0：世界书条目名（comment 与 keys）—— 给「未声明块清理」当保护名单用
            prof.bookTitles = [];
            for (const e of entries) {
                if (e && e.comment) prof.bookTitles.push(String(e.comment));
                for (const k of ((e && e.keys) || [])) prof.bookTitles.push(String(k));
            }
        } catch (_) { prof.varSpec = ''; prof.required = []; prof.allowed = { paths: [], prefixes: [], wildcards: [], all: [] }; }
        // 0.4.0 变量协议识别（MVU / 任意 JSONPatch / YAML 块 / _.set / setvar 宏 / 无）
        try {
            prof.protocol = detectVariableProtocol({
                text: cardTextForProtocol(ch),
                varSpec: prof.varSpec,
                dataTags: prof.dataTags,
                blockTags: [...(prof.dataTags || []), ...(prof.anchors || [])],
            });
        } catch (_) { prof.protocol = { id: 'none', label: '（识别失败）', canWriteBack: false, tags: [] }; }
        try { const dv = detectDisabledViews(ext); prof.disabledViews = { total: dv.total || 0, uncovered: dv.uncovered || 0 }; } catch (_) {}
        profCache = { key: key, prof: prof, at: Date.now() };
        return prof;
    } catch (_) { return buildProfile({}); }
}
const PROMPT_KEY = 'card-compat-tail';
/** 生成前注入提醒：让模型必须写出当前卡要求的结构块（不点名别的卡的标签） */
function updatePromptInjection() {
    try {
        const s = settings();
        if (!s?.enabled || !s.injectPrompt) { setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.NONE, 0); return; }
        const prof = profileOf();
        // 0.9.3：提醒按顶层分组轮询取 14 条 —— 旧实现只取前 12 条，实测会让「互动次数 / 身体状态 / user.累计支出」
        // 永远进不了提醒（那张卡前 12 条全是系统+林婉婷基础字段），模型每轮都忘更新这些
        const text = buildTailReminder(prof, { varSpec: prof.varSpec || '', required: pickReminderFields(prof.required || [], 14) });
        setExtensionPrompt(PROMPT_KEY, text, text ? extension_prompt_types.IN_CHAT : extension_prompt_types.NONE, 0, false, extension_prompt_roles.SYSTEM);
        if (settings().logActions) console.debug('[card-compat] 注入提醒长度=' + text.length + ' 变量格式=' + ((prof.varSpec || '').length) + ' 字符');
    } catch (e) { console.error('[card-compat] prompt inject failed', e); }
}
/** 懒加载扩展自带的 js-yaml（页面里已有 window.jsyaml 就直接用，避免重复加载） */
const VENDOR_YAML_URL = (() => { try { return new URL('./assets/js-yaml.min.js', import.meta.url).href; } catch (_) { return 'assets/js-yaml.min.js'; } })();
let yamlLibPromise = null;
/** 同步取已加载的 js-yaml（没加载就返回 null，交给内置解析器兜底） */
function yamlLibSync() {
    try { if (typeof window !== 'undefined' && window.jsyaml && typeof window.jsyaml.load === 'function') return window.jsyaml; } catch (_) {}
    return null;
}
function loadYamlLib() {
    if (!yamlLibPromise) {
        yamlLibPromise = (async () => {
            try { if (typeof window !== 'undefined' && window.jsyaml && typeof window.jsyaml.load === 'function') return window.jsyaml; } catch (_) {}
            try {
                await new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    s.src = VENDOR_YAML_URL; s.async = true;
                    s.onload = () => resolve(); s.onerror = () => reject(new Error('script load failed'));
                    document.head.appendChild(s);
                });
                return (typeof window !== 'undefined' && window.jsyaml && typeof window.jsyaml.load === 'function') ? window.jsyaml : null;
            } catch (e) { console.warn('[card-compat] js-yaml 加载失败：' + ((e && e.message) || e)); return null; }
        })();
    }
    return yamlLibPromise;
}
const strictChecked = new Map();   // messageId -> 已校验过的内容指纹，避免同一楼层反复解析
const SET_CAP = 400;               // 这四个集合原先无上限：长聊天会一直涨（严格校验还存过整条消息文本）
/** 只保留最近 N 条（Map：按插入顺序丢最旧的键） */
function capMap(m) { while (m.size > SET_CAP) m.delete(m.keys().next().value); }
/** Set 版同上 */
function capSet(s) { while (s.size > SET_CAP) s.delete(s.values().next().value); }
/** 内容指纹：严格校验原先把整条消息文本存进 Map，长聊天就是几十~上百 MB；这里只留长度+首尾+哈希 */
function fingerprintOf(s) {
    const t = String(s || '');
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return t.length + ':' + h + ':' + t.slice(0, 24) + ':' + t.slice(-24);
}
/** 结构块严格 YAML 校验（真解析）：失败就在面板/日志里报警，不改文本 */
async function strictCheckMessage(messageId, opts = {}) {
    try {
        const s = settings();
        const m = chat && chat[messageId];
        if (!s || !s.enabled || !m || typeof m.mes !== 'string') return null;
        if (!s.yamlStrict && !opts.force) return null;
        const profile = profileOf();
        const tags = [...(profile.dataTags || []), ...(profile.anchors || [])];
        if (!tags.length) return null;
        if (!tags.some((t) => m.mes.includes('<' + t))) return null;   // 没结构块就不去加载库
        if (strictChecked.get(messageId) === fingerprintOf(m.mes) && !opts.force) return null;
        const lib = await loadYamlLib();
        if (!lib) { stats.yamlStrictSkipped++; log('yaml-strict-skipped', '', 'js-yaml 不可用（assets 加载失败），已跳过严格校验'); renderStats(); return null; }
        const r = strictYamlCheck(m.mes, tags, lib);
        strictChecked.set(messageId, fingerprintOf(m.mes));
        capMap(strictChecked);
        if (!r.checked) return null;
        if (r.issues.length) {
            stats.yamlStrictFail += r.issues.length;
            log('yaml-strict-fail', r.issues.map((i) => i.tag).join(','), '解析失败：' + r.issues[0].error + '（面板数据可能显示不全）');
        } else {
            stats.yamlStrictOk += r.blocks;
            if (opts.force) log('yaml-strict-ok', r.blocks + ' 个结构块', '解析通过');
        }
        renderStats();
        return r;
    } catch (e) { console.warn('[card-compat] strictCheckMessage: ' + ((e && e.message) || e)); return null; }
}

/* ── MVU 联动（P3 ⑨）：探测 API、试解析、检测「额外模型解析」以免双写 ── */
function mvuApi() {
    try { if (typeof window !== 'undefined' && window.Mvu) return window.Mvu; } catch (_) {}
    try { if (typeof window !== 'undefined' && window.parent && window.parent.Mvu) return window.parent.Mvu; } catch (_) {}
    return null;
}
function mvuInfo() {
    const M = mvuApi();
    if (!M) return { api: false };
    return {
        api: true,
        version: String(M.version || M.VERSION || ''),
        parse: typeof M.parseMessage === 'function',
        write: typeof M.replaceCurrentMvuData === 'function' || typeof M.replaceMvuData === 'function',
        read: typeof M.getCurrentMvuData === 'function' || typeof M.getMvuData === 'function',
    };
}
/** 读 MVU 自己的设置：额外模型解析开着的话，本扩展的自动补变量让位，避免同一轮被解析两次 */
function mvuExtraParseEnabled() {
    try {
        const ctx = getContext();
        const es = (ctx && ctx.extensionSettings) || extension_settings || {};
        const pools = [es.mvu_settings, es.MVU, es.MagVarUpdate, es.mag_var_update, es['mag-var-update']];
        for (const pool of pools) {
            if (!pool || typeof pool !== 'object') continue;
            let v = pool['额外模型解析'];
            if (v === undefined) v = pool.extra_model_parse;
            if (v === undefined) v = pool.extraModelParse;
            if (v === undefined && pool['额外模型解析配置'] && typeof pool['额外模型解析配置'] === 'object') v = pool['额外模型解析配置'].enabled;
            if (typeof v === 'boolean') return v;
            if (typeof v === 'string') return /^(true|on|开|启用|yes)$/i.test(v.trim());
        }
    } catch (_) {}
    return null;
}
/** 让 MVU 真解析一次（只读试算：parseMessage 接收当前数据副本、返回新数据，不改宿主） */
/** 按楼层取 MVU 数据（优先 getMvuData({type:'message'})；旧别名忽略 messageId，只能兜底） */
async function mvuDataOf(messageId) {
    const M = mvuApi();
    if (!M) return { api: null, data: null };
    try {
        if (typeof M.getMvuData === 'function') return { api: M, data: await M.getMvuData({ type: 'message', message_id: messageId }) };
    } catch (_) {}
    try { if (typeof M.getCurrentMvuData === 'function') return { api: M, data: await M.getCurrentMvuData() }; } catch (_) {}
    return { api: M, data: null };
}
/** 按楼层写回（优先 replaceMvuData；replaceCurrentMvuData 只在「就是当前楼层」时用） */
async function mvuReplaceOf(next, messageId) {
    const M = mvuApi();
    if (!M) return false;
    try {
        if (typeof M.replaceMvuData === 'function') { await M.replaceMvuData(next, { type: 'message', message_id: messageId }); return true; }
    } catch (_) {}
    try {
        const isCurrent = (() => { try { const c = getContext(); return !c || c.chatId === undefined ? true : true; } catch (_) { return true; } })();
        if (isCurrent && typeof M.replaceCurrentMvuData === 'function') { await M.replaceCurrentMvuData(next); return true; }
    } catch (_) {}
    return false;
}
/**
 * MVU 能否真解析这一块（0.15.0 修）：
 * 原先传 `parseMessage(block, {})` 用的空基线 —— 与 MVU 的真实上下文不同，且命令级错误在 MVU 里只 warn 不抛，
 * 于是「路径不存在」这类真故障也会给出假 ✅。现在拿该楼真实数据当基线，并以 stat_data 是否真的变化作为判定。
 */
async function mvuCanParse(blockText, messageId) {
    const M = mvuApi();
    if (!M || typeof M.parseMessage !== 'function') return { checked: false, reason: 'no-api' };
    try {
        const base = (messageId === undefined || messageId === null) ? null : (await mvuDataOf(messageId)).data;
        const before = base && base.stat_data ? JSON.stringify(base.stat_data) : null;
        const next = await M.parseMessage(blockText, base || {});
        const after = next && next.stat_data ? JSON.stringify(next.stat_data) : null;
        if (before !== null && after !== null && before === after) return { checked: true, ok: false, reason: '解析后 stat_data 没有变化（命令可能没命中任何路径）' };
        return { checked: true, ok: true };
    } catch (e) { return { checked: true, ok: false, reason: String((e && e.message) || e).slice(0, 160) }; }
}
/** 把补出来的补丁真正写回 MVU（否则只追加文本，状态栏不会更新） */
async function applyPatchToMvu(blockText, messageId) {
    const M = mvuApi();
    if (!M || typeof M.parseMessage !== 'function') return { ok: false, reason: '找不到 Mvu API（可点 MVU 面板的「重新处理变量」应用）' };
    try {
        // 0.15.0：按 messageId 读该楼数据、按 messageId 写回（旧别名 getCurrentMvuData/replaceCurrentMvuData 忽略 id，
        // 会让「写回旧楼层」变成「写进当前楼层」）
        const cur = (messageId === undefined || messageId === null) ? null : (await mvuDataOf(messageId)).data;
        const next = await M.parseMessage(blockText, cur || {});
        if (!(await mvuReplaceOf(next, messageId))) return { ok: false, reason: 'Mvu 没有写入接口' };
        return { ok: true };
    } catch (e) { return { ok: false, reason: '写入 MVU 失败: ' + String((e && e.message) || e) }; }
}
/** 找出某楼层里第一个变量块文本（供「写回 MVU」按钮用） */
function blockOfMessage(messageId) {
    try { const m = chat && chat[messageId]; if (!m || typeof m.mes !== 'string') return ''; const ex = extractUpdateBlock(m.mes); return ex ? ex.block : ''; } catch (_) { return ''; }
}
/** P1 ①：MVU 写回兜底 —— 若 API 不在，明确告诉用户点 MVU 面板的「重新处理变量」 */
async function writeBackMvu(messageId, quiet) {
    if (settings()?.compatMode) { if (!quiet) toast(langOf() === 'en' ? 'Compat mode is on' : '兼容模式已开启，已跳过 MVU 写回', 'info'); return { ok: false, reason: 'compat-mode' }; }
    const block = blockOfMessage(messageId);
    if (!block) { if (!quiet) toast(langOf() === 'en' ? 'No variable block in this reply' : '该楼层没有变量块', 'warning'); return { ok: false, reason: 'no-block' }; }
    const r = await applyPatchToMvu(block, messageId);
    if (r.ok) { log('mvu-writeback', '第' + messageId + '层', '已写回 MVU 变量'); if (!quiet) toast(T('mvuWriteOk'), 'success'); }
    else { log('mvu-writeback-fail', '第' + messageId + '层', r.reason + '；可在 MVU 面板点「重新处理变量」'); if (!quiet) toast(T('mvuWriteFail') + r.reason, 'warning'); }
    renderStats();
    return r;
}
/** P2 ⑨ / P1 ③：MVU 能否解析本轮变量块（提前发现「块在但解析不了」） */
async function mvuVerifyMessage(messageId) {
    try {
        const s = settings();
        if (!s || !s.enabled || !s.mvuVerify || s.compatMode) return null;
        const m = chat && chat[messageId];
        if (!m || m.is_user || typeof m.mes !== 'string') return null;
        const ex = extractUpdateBlock(m.mes);
        if (!ex) return null;
        const r = await mvuCanParse(ex.block, messageId);
        if (!r.checked) return null;
        if (r.ok) { stats.mvuParseOk++; if (s.logActions) console.debug('[card-compat] MVU 试解析通过 #' + messageId); }
        else { stats.mvuParseFail++; log('mvu-parse-fail', '第' + messageId + '层', T('mvuUnparsed') + r.reason); }
        renderStats();
        return r;
    } catch (_) { return null; }
}

/* ── 变量块兜底（v0.2.8）：模型没输出 <UpdateVariable> 时，用一次「只补补丁」的静默生成补上 ── */
const varFixTriedIds = new Set();
let varFixFailStreak = 0;
let varFixPausedUntil = 0;

/**
 * 兜底主流程：卡声明了变量块 + 该层缺块 + 开关打开 → 用一段「只输出补丁」的短提示词静默生成一次，
 * 校验通过才写盘；连续失败 2 次自动暂停 10 分钟，避免刷 API。
 * MVU 自己的「额外模型解析」开着时直接让位（同一轮解析两次会互相覆盖）。
 */
async function maybeFixVars(messageId) {
    try {
        const s = settings();
        if (!s || !s.enabled || !s.autoFixVars || s.compatMode) return null;
        if (messageId == null || varFixTriedIds.has(messageId)) return null;
        if (Date.now() < varFixPausedUntil) return null;
        const extra = mvuExtraParseEnabled();
        if (extra === true) {
            if (!mvuExtraLogged) { mvuExtraLogged = true; log('mvu-extra-parse', '', T('mvuExtraOn')); }
            return null;
        }
        const profile = profileOf();
        const dataTags = profile.dataTags || [];
        if (!dataTags.length) return null;                       // 只对声明了变量块的卡生效
        const m = chat && chat[messageId];
        if (!m || m.is_user || typeof m.mes !== 'string') return null;
        if (extractUpdateBlock(m.mes)) return null;              // 已经有了
        varFixTriedIds.add(messageId);
    capSet(varFixTriedIds);
        stats.varFixTried++;
        renderStats();
        const prevUser = (() => { try { for (let k = messageId - 1; k >= 0; k--) { const x = chat[k]; if (x && x.is_user && x.mes) return x.mes; } } catch (_) {} return ''; })();
        const base = { varSpec: profile.varSpec || '', required: profile.required || [], messageText: m.mes, lastUserText: prevUser, maxChars: s.autoFixVarsMaxChars || 6000 };
        let out = '';
        for (const strict of [false, true]) {
            const prompt = buildVarFixPrompt(Object.assign({}, base, { strict: strict }));
            log('varfix-request', '第' + messageId + '层' + (strict ? '(重试)' : ''), prompt.length + ' 字符提示词');
            out = await generateQuietPrompt({ quietPrompt: prompt, responseLength: 900, removeReasoning: true });
            const ex = extractUpdateBlock(out);
            const patch = ex ? ex.patchText : out;
            const v = validatePatchBlock(patch);
            if (v.ok) {
                const blockText = ex ? ex.block : ('<UpdateVariable>' + String.fromCharCode(10) + '<JSONPatch>' + String.fromCharCode(10) + patch + String.fromCharCode(10) + '</JSONPatch>' + String.fromCharCode(10) + '</UpdateVariable>');
                m.mes = m.mes.replace(/\s+$/, '') + String.fromCharCode(10) + blockText;
                stats.varFixOk++;
                log('varfix-ok', '第' + messageId + '层', v.ops + ' 条操作，已追加到消息');
                try { saveChatDebounced(); } catch (_) {}
                try { updateMessageBlock(messageId, m, { rerenderMessage: true }); } catch (_) {}
                nudgeRender(messageId);
                const applied = await applyPatchToMvu(blockText, messageId);
                if (applied.ok) { stats.varFixApplied++; log('varfix-applied', '第' + messageId + '层', '已写回 MVU 变量'); }
                else log('varfix-not-applied', '第' + messageId + '层', applied.reason);
                varFixFailStreak = 0;
                setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.NONE, 0);
                updatePromptInjection();
                setTimeout(() => { try { guardMessage(messageId); } catch (_) {} }, 600);
                renderStats();
                return { ok: true, ops: v.ops, applied: applied.ok };
            }
            log('varfix-invalid', '第' + messageId + '层' + (strict ? '(重试)' : ''), v.problems.join('；'));
        }
        stats.varFixFailed++;
        varFixFailStreak++;
        if (varFixFailStreak >= 2) { varFixPausedUntil = Date.now() + 10 * 60 * 1000; log('varfix-paused', '', '连续失败 2 次，暂停 10 分钟'); }
        if (settings().toastOnFail) toast((langOf() === 'en' ? 'Auto variable fix failed twice, paused for 10 minutes' : '自动补变量连续失败 2 次，已暂停 10 分钟'), 'warning');
        renderStats();
        return { ok: false };
    } catch (e) {
        stats.varFixFailed++;
        log('varfix-error', '', String((e && e.message) || e));
        return null;
    }
}

/**
 * 0.2.9 修复「必须刷新页面状态栏才变回面板」：
 *   ST 的 updateMessageBlock(id, m, {rerenderMessage:true}) 只重建 .mes_text，**全程不发任何事件**；
 *   而酒馆助手（TavernHelper）的前端块（卡的状态栏就是 html 围栏）只在
 *     chatLoaded / MORE_MESSAGES_LOADED 时做全量转换，运行时只靠
 *     CHARACTER_MESSAGE_RENDERED / MESSAGE_UPDATED / MESSAGE_SWIPED 做「单楼增量」。
 *   我们重渲染之后不补一次事件，那一楼就会停在源码 <pre> 状态，直到用户刷新页面。
 */
function nudgeRender(messageId) {
    try {
        const s = settings();
        if (!s || s.nudgeRender === false || s.compatMode) return false;   // 兼容模式：不发事件、不碰别人的渲染
        const ev = event_types.MESSAGE_UPDATED;
        if (!ev) return false;
        const r = eventSource.emit(ev, messageId);
        if (r && typeof r.catch === 'function') r.catch(() => {});
        if (s.logActions) console.debug('[card-compat] 重渲染后补发 MESSAGE_UPDATED #' + messageId + '（让酒馆助手重新转换前端块）');
        return true;
    } catch (e) { return false; }
}
/** 补发事件后自检：前端块有没有真的被渲染成面板（酒馆助手改了渲染方式时这里会命中） */
function checkNudgeApplied(messageId) {
    try {
        const s = settings();
        if (!s || s.compatMode || messageId == null) return;
        const el = document.querySelector('#chat .mes[mesid="' + messageId + '"] .mes_text');
        if (!el) return;
        const pres = [...el.querySelectorAll('pre')];
        const fe = pres.filter((p) => /html>|<head>|<body/.test(p.textContent || ''));
        if (!fe.length) return;                 // 这一楼本来就没有前端块
        if (el.querySelector('iframe')) return;  // 已经是面板了
        stats.nudgeMisses++;
        log('nudge-missed', '第' + messageId + '层', '补发事件后前端块仍未渲染：酒馆助手可能改了渲染方式 → 刷新页面，或用面板第④组的「兼容模式」');
    } catch (_) {}
}
const FAIL_CAT_MAP = { 'data-missing': 'data', 'varfix-invalid': 'varfix', 'yaml-strict-fail': 'yaml', 'block-yaml-issue': 'yaml', 'undeclared-block-stripped': 'undeclared' };
function log(type, tag, extra) {
    const cat = FAIL_CAT_MAP[type];
    if (cat) { failTrace.push({ t: Date.now(), cat: cat, tag: String(tag || '').slice(0, 40) }); while (failTrace.length > 20) failTrace.shift(); trackFailure(cat, String(tag || '')); }
    recent.unshift({ t: new Date().toLocaleTimeString(), type: type, tag: tag, extra: extra || '' });
    if (recent.length > 40) recent.pop();
    renderStats();
    if (settings()?.logActions) console.debug('[card-compat] ' + type + ' ' + tag + ' ' + (extra || ''));
}
/**
 * 0.16.2：同类硬失败连续 3 楼 → 弹一次提示（10 分钟冷却，跨楼层计数）。
 * 原先 data-missing / varfix-invalid / yaml-strict-fail 只写进面板日志，用户看不到，
 * 表现为「状态栏不动但什么提示都没有」。这里只做只读统计 + 一次提示，不触碰写入路径。
 */
function trackFailure(cat, tag) {
    if (!cat) return false;
    try { if (settings() && settings().toastOnFail === false) return false; } catch (_) { return false; }
    // 0.16.2：判定抽到 logic.js 的 noteFailure（夹具和运行时同一份实现，避免只在测里对）
    const r = noteFailure(failStreak, cat, Date.now(), { threshold: 3, cooldownMs: 10 * 60 * 1000, lastAt: failAlerted.get(cat) || 0 });
    const streak = r.streak;
    const now = Date.now();
    if (r.alert) {
        failAlerted.set(cat, now);
        const label = T('fail_' + cat) || cat;
        const floorNo = (chat && chat.length) ? chat.length : 0;
        toast(label + T('failTimes', { n: streak }) + (floorNo ? ((langOf() === 'en' ? ' (floor ' : '（第') + floorNo + (langOf() === 'en' ? ')' : ' 楼）')) : ''), 'warning');
        logSilent('fail-visible', cat, '连续 ' + streak + ' 楼「' + label + '」，已提示一次（10 分钟内不重复）');
    }
    return true;
}
/** 记日志但不参与失败统计（可见化自身用它，否则会自己触发自己） */
function logSilent(type, tag, extra) {
    recent.unshift({ t: new Date().toLocaleTimeString(), type: type, tag: tag, extra: extra || '' });
    if (recent.length > 40) recent.pop();
    renderStats();
}
function applyFont() {
    const s = settings() || {};
    const css = [
        s.enabled && s.fontZoom && Number(s.fontZoom) !== 1 ? '.mes_text{zoom:' + s.fontZoom + ';}' : '',
        s.enabled && s.fontFloor ? '.mes_text :is(div,span,p,td,th,li,button,small,strong,em){font-size:max(' + s.fontFloor + 'px,1em) !important;}' : '',
    ].filter(Boolean).join(String.fromCharCode(10));
    let el = document.getElementById('cc-font-style');
    if (!el) { el = document.createElement('style'); el.id = 'cc-font-style'; document.head.appendChild(el); }
    el.textContent = css;
}
/** 覆盖度趋势（P2 ⑥）：把覆盖率画成方块条 */
function coverBar(ratio) {
    const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const i = Math.max(0, Math.min(blocks.length - 1, Math.round(ratio * (blocks.length - 1))));
    return blocks[i];
}
function coverageTrendText() {
    if (!covHistory.length) return '';
    const tail = covHistory.slice(-16);
    const bars = tail.map((h) => coverBar(h.total ? h.hit / h.total : 0)).join('');
    const last10 = covHistory.slice(-10).filter((h) => h.total);
    const prev10 = covHistory.slice(-20, -10).filter((h) => h.total);
    const avg = (arr) => (arr.length ? Math.round(100 * arr.reduce((a, b) => a + (b.total ? b.hit / b.total : 0), 0) / arr.length) : null);
    const a = avg(last10), b = avg(prev10);
    const arrow = (a !== null && b !== null) ? (a > b ? ' ↑' : (a < b ? ' ↓' : ' →')) : '';
    return bars + '  ' + (a === null ? '' : a + '%') + (b === null ? '' : ('（前 10 轮 ' + b + '%）')) + arrow;
}/**
 * 0.18.0（UI 优化）：趋势从「▁▃▅ 21%（前 10 轮 18%）」这种要解码的文本，改成**能看的条**：
 * 每层一根竖条（高度=覆盖率，颜色随高低变化），右侧一个大号百分比 + 与前 10 轮的对比箭头。
 */
function renderTrend() {
    const el = document.getElementById('cc-trend');
    if (!el) return;
    if (!covHistory.length) { el.innerHTML = '<div class="cc-line cc-muted">' + escHtml(T('covTrendNone')) + '</div>'; return; }
    const tail = covHistory.slice(-16);
    const ratioOf = (h) => (h && h.total ? Math.max(0, Math.min(1, h.hit / h.total)) : 0);
    const bars = tail.map((h) => {
        const r = ratioOf(h);
        const cls = r >= 0.8 ? 'ok' : (r >= 0.5 ? 'mid' : 'low');
        const hh = Math.max(3, Math.round(r * 34));
        return '<i class="' + cls + '" style="height:' + hh + 'px" title="' + escHtml(String(h.hit) + '/' + String(h.total) + '（' + Math.round(r * 100) + '%）') + '"></i>';
    }).join('');
    const txt = coverageTrendText();
    const m = txt.match(/(\d+)%/);
    const pct = m ? Number(m[1]) : Math.round(ratioOf(tail[tail.length - 1]) * 100);
    const arrow = txt.indexOf('↑') >= 0 ? '↑' : (txt.indexOf('↓') >= 0 ? '↓' : '→');
    const cls = pct >= 80 ? 'ok' : (pct >= 50 ? 'mid' : 'low');
    el.innerHTML = '<div class="cc-trend-row"><span class="cc-trend-label">' + escHtml(T('covTrend')) + '</span>'
        + '<span class="cc-trend-bars">' + bars + '</span>'
        + '<b class="cc-trend-pct ' + cls + '">' + pct + '% <span class="cc-trend-arrow">' + arrow + '</span></b></div>';
}

/**
 * 0.13.2：独立构建/刷新「本卡要求 vs 本轮实际」报表。
 * 旧版只在「本卡有规则 **且** 本楼有 <UpdateVariable>」时才写 lastReport ——
 * 于是切换角色卡后，如果新卡的楼不满足条件，面板会一直显示上一张卡的旧表（用户实测截图）。
 * 现在：不管有没有变量块都建表（没有就是「全部未更新」），并且由 ref。
 * @param {number} messageId 目标楼层（通常是最后一条 assistant 消息）
 * @param {{log?:boolean}} [opts]
 */
// 0.21.0：资金纠正 = 用 ThHelper 的公开写入接口补一条 delta。每次写入前留快照，可在面板撤销。
const moneyFixStack = [];   // { at, floor, path, delta, before }
/** 应用一条资金纠正（返回是否写入） */
/** 按状态表写回：读该楼（或上一楼）状态 → 与表深合并 → 确认后写入（快照 + 可撤销） */
async function applyTableWrite(messageId) {
    try {
        if ((settings() || {}).tableWrite === false) { toast(T('tableWriteOff'), 'info'); return false; }
        const m = chat && chat[messageId];
        if (!m || typeof m.mes !== 'string') return false;
        const tbl0 = parseStatusTable(m.mes, { yamlLib: yamlLibSync() });
        const tbl = (tbl0 && tbl0.ok) ? tbl0 : (Array.isArray(m.swipes) ? (m.swipes.map((x) => parseStatusTable(String(x || ''), { yamlLib: yamlLibSync() })).find((x) => x && x.ok) || { ok: false }) : { ok: false });
        if (!tbl.ok) { toast(T('tableParseFail'), 'warning'); return false; }
        const scope = varScope();
        const before = readStateOf(messageId, scope.scope) || readStateOf(messageId - 1, scope.scope);
        if (!before) { toast(T('moneyFixNoBase'), 'warning'); return false; }
        const merged = mergeStatusTable(before, tbl.data);
        const diff = statusTableDiff(before, merged, 40);
        if (!diff.length) { toast(T('tableNoChange'), 'info'); return false; }
        const head = diff.slice(0, 6).map((c) => escHtml(c.path) + '：' + escHtml(String(c.from).slice(0, 10)) + ' → ' + escHtml(String(c.to).slice(0, 16))).join('<br>');
        const more = diff.length > 6 ? ('<br>… ' + escHtml(T('tableMore', { n: diff.length - 6 }))) : '';
        const ok = await callGenericPopup('<b>' + escHtml(T('tableWriteBtn')) + '</b><br>' + escHtml(T('tableWriteConfirm', { n: diff.length })) + '<br><br>' + head + more, POPUP_TYPE.CONFIRM);
        if (!ok) return false;
        if (!writeStateOf(messageId, merged, scope.scope)) { toast(T('moneyFixWriteFail'), 'warning'); return false; }
        moneyFixStack.push({ at: Date.now(), floor: messageId, path: T('tableWriteBtn'), delta: 0, before: before });
        while (moneyFixStack.length > 20) moneyFixStack.shift();
        stats.tableWrite = (stats.tableWrite || 0) + 1;
        log('table-write', '第' + messageId + '层', '按状态表写回 ' + diff.length + ' 处变化（可撤销）');
        rerenderFloor(messageId);
        renderStats();
        toast(T('tableWriteOk', { n: diff.length }), 'success');
        return true;
    } catch (e) { log('table-write-failed', '', String((e && e.message) || e)); toast(T('moneyFixWriteFail'), 'warning'); return false; }
}
function applyMoneyFix(messageId, path, delta) {
    try {
        if ((settings() || {}).moneyFix === false) { toast(T('moneyFixOff'), 'info'); return false; }
        const scope = varScope();
        const before = readStateOf(messageId, scope.scope);
        if (!before) { toast(T('moneyFixNoBase'), 'warning'); return false; }
        const after = JSON.parse(JSON.stringify(before));
        const segs = String(path).replace(/^\//, '').split('/').filter(Boolean);
        let node = after;
        for (let i = 0; i < segs.length - 1; i++) { if (!node[segs[i]] || typeof node[segs[i]] !== 'object') node[segs[i]] = {}; node = node[segs[i]]; }
        const last = segs[segs.length - 1];
        if (typeof node[last] !== 'number') { toast(T('moneyFixBadTarget'), 'warning'); log('money-fix-abort', path, '目标字段不是数字（' + typeof node[last] + '），拒绝代写'); return false; }
        const cur = node[last];
        node[last] = cur + Number(delta);
        if (!writeStateOf(messageId, after, scope.scope)) { toast(T('moneyFixWriteFail'), 'warning'); return false; }
        moneyFixStack.push({ at: Date.now(), floor: messageId, path: path, delta: delta, before: before });
        while (moneyFixStack.length > 20) moneyFixStack.shift();
        stats.moneyFix = (stats.moneyFix || 0) + 1;
        log('money-fix', '第' + messageId + '层 ' + path, (delta > 0 ? '+' : '') + delta + '（已写入，可撤销）');
        rerenderFloor(messageId);
        renderStats();
        return true;
    } catch (e) { log('money-fix-failed', '', String((e && e.message) || e)); toast(T('moneyFixWriteFail'), 'warning'); return false; }
}
/** 撤销上一次资金纠正 */
function undoMoneyFix() {
    const last = moneyFixStack[moneyFixStack.length - 1];
    if (!last) { toast(T('moneyUndoNone'), 'info'); return; }
    try {
        const scope = varScope();
        if (!writeStateOf(last.floor, last.before, scope.scope)) { toast(T('moneyFixWriteFail'), 'warning'); return; }
        moneyFixStack.pop();
        log('money-undo', '第' + last.floor + '层 ' + last.path, '已撤销 ' + (last.delta > 0 ? '+' : '') + last.delta);
        rerenderFloor(last.floor);
        renderStats();
        toast(T('moneyUndoOk'), 'success');
    } catch (e) { toast(T('moneyFixWriteFail'), 'warning'); }
}
/** 资金对账：拿最近若干层，比较模型在补丁里写的金额与账本（stat_data）的实际变化 */
function moneyLedgerCheck(messageId, span) {
    try {
        const from = Math.max(0, messageId - (span || 12));
        const rows = [];
        let prevStored = null;
        for (let i = from; i <= messageId; i++) {
            const mes = chat && chat[i] && typeof chat[i].mes === 'string' ? chat[i].mes : '';
            if (!mes) continue;
            const ops = (extractUpdateBlocks(mes) || []).reduce((n, b) => n.concat(parsePatchOps(b.patchText || b.block).ops || []), []);
            const spendOps = ops.filter((x) => /累计支出/.test(String((x && x.path) || '')));
            const sd = mvuVarsOf(i);
            let stored = null;
            try { const u = sd && sd.user; if (u && typeof u === 'object') { for (const k of Object.keys(u)) { if (/累计支出/.test(k) && typeof u[k] === 'number') { stored = (stored || 0) + u[k]; } } } } catch (_) {}
            rows.push({ floor: i, ops: spendOps, stored: stored, prevStored: prevStored });
            if (stored != null) prevStored = stored;
        }
        return moneyLedgerDrift(rows);
    } catch (_) { return null; }
}
function buildReport(messageId, opts) {
    try {
        const m = chat && chat[messageId];
        if (!m || typeof m.mes !== 'string') { lastReport = null; return null; }
        const profile = profileOf();
        const req = profile.required || [];
        const hasBlock = m.mes.includes('<UpdateVariable>');
        let cardName = '';
        try { const ctx = getContext(); const ch = ctx && ctx.characters && ctx.characters[ctx.characterId]; cardName = (ch && ch.name) || ''; } catch (_) {}
        const report = { id: messageId, card: cardName, required: req, covered: [], missing: req.map((f) => f.path), written: [], blocks: 0, unknownPaths: [], extraPaths: [] };
        lastReport = report;                      // 先挂上，后面 log() 触发的渲染就不会再画旧表
        try { report.stripped = strippedByFloor.get(messageId) || null; } catch (_) {}
        // 0.22.0：资金体检/对账/纠正都受面板开关控制（moneyCheck / moneyFix）
        const sMoney = settings() || {};
        // 0.20.0：资金账目对账 —— 最近 12 层「模型打算写的金额」vs「账本实际变化」
        try { if (sMoney.moneyCheck !== false) report.ledger = moneyLedgerCheck(messageId); } catch (_) {}
        // 0.23.0：实测病灶 —— 模型只打印 <status_current_variables> 状态表，完全没给 <JSONPatch>，
        // 于是 MVU 没有任何补丁可应用 → 回复里明明写着新状态，数据却不更新。这里把表解析出来供一键写回。
        try {
            if ((settings() || {}).tableWrite !== false && !/<JSONPatch\b/i.test(m.mes)) {
                const tbl = parseStatusTable(m.mes, { yamlLib: yamlLibSync() }) ;
                // 0.23.1：当前文本里没有表时，退回 swipes 备档（旧版误删的内容还在 swipe 里，可据此写回）
                const tblFb = (tbl && tbl.ok) ? tbl : (Array.isArray(m.swipes) ? m.swipes.map((x) => parseStatusTable(String(x || ''), { yamlLib: yamlLibSync() })).find((x) => x && x.ok) : null);
                if (tblFb && tblFb.ok) {
                    const base = mvuVarsOf(messageId) || mvuVarsOf(messageId - 1) || null;
                    const merged = mergeStatusTable(base || {}, tblFb.data);
                    const diff = statusTableDiff(base || {}, merged, 40);
                    report.table = { tag: tblFb.tag, changes: diff.length, sample: diff.slice(0, 6), base: !!base, fromSwipe: !(tbl && tbl.ok) };
                }
            }
        } catch (_) {}
        // 0.21.0：能纠正的才给「应用」按钮（规则明确 = 有 累计支出_X 锚点且能找到对应现金路径）
        try {
            if (report.money && report.money.missingCash) {
                const mfBlocks2 = extractUpdateBlocks(m.mes);
                const mfPatch2 = mfBlocks2.map((b) => (b && (b.patchText || b.block)) || '').join('\n');
                const mfOps = mfBlocks2.reduce((n, b) => n.concat(parsePatchOps(b.patchText || b.block).ops || []), []);
                if (sMoney.moneyFix !== false) report.fix = moneyCorrection({ amount: report.money.n, ops: mfOps, patchText: mfPatch2, state: mvuVarsOf(messageId) || null, minAmount: 500 });
            }
        } catch (_) {}
        // 0.20.0：资金流体检 —— 正文提到钱、补丁却没落到现金/欠款字段时，把这条摆到面板上
        try {
            const mfBlocks = extractUpdateBlocks(m.mes);
            const mfPatch = mfBlocks.map((b) => (b && (b.patchText || b.block)) || '').join('\n');
            if (sMoney.moneyCheck !== false) report.money = moneyFlowHint(m.mes, mfPatch, { minAmount: 500 });
        } catch (_) {}
        if (req.length && hasBlock) {
            const cov = coverageByProtocol(m.mes, req, profile.protocol);
            lastCoverage = cov;
            stats.coverageTotal = cov.total;
            stats.coverageHit = cov.covered.length;
            if (settings().coverageHistory !== false) {
                covHistory.push({ at: Date.now(), id: messageId, hit: cov.covered.length, total: cov.total, blocks: cov.blocks || 1 });
                while (covHistory.length > 40) covHistory.shift();
            }
            report.covered = cov.covered;
            report.missing = cov.missing;
            report.written = cov.written || [];
            report.blocks = cov.blocks || 1;
            if (settings().pathWarn !== false) {
                for (const b of extractUpdateBlocks(m.mes)) {
                    const vp = validatePatchPaths(b.patchText || b.block, profile.allowed || {});
                    if (vp.checked) {
                        for (const u of vp.unknown) if (report.unknownPaths.indexOf(u.path) < 0) report.unknownPaths.push(u.path);
                        for (const e of vp.extra) if (report.extraPaths.indexOf(e) < 0) report.extraPaths.push(e);
                    }
                }
                if (report.unknownPaths.length) { stats.pathUnknown += report.unknownPaths.length; log('path-unknown', report.unknownPaths.join(','), '补丁写了本卡规则里没有的路径（可能是模型自创字段）'); }
                if (report.extraPaths.length) { stats.extraPaths += report.extraPaths.length; log('path-extra', report.extraPaths.join(','), '组内路径但卡未逐条声明（放行，仅提示）'); }
            }
            if (!opts || opts.log !== false) log('patch-coverage', cov.covered.length + '/' + cov.total, cov.missing.length ? ('缺: ' + cov.missing.join('、')) : '全部覆盖 ✅');
        }
        return report;
    } catch (_) { return null; }
}

let cardKey = '';
/** 0.13.2：当前卡的标识（角色 id + 头像/名字），用来发现「切卡」 */
function cardKeyNow() {
    try {
        const ctx = getContext();
        const ch = ctx && ctx.characters && ctx.characters[ctx.characterId];
        return String((ctx && ctx.characterId) || '') + '|' + String((ch && (ch.avatar || ch.name)) || '');
    } catch (_) { return ''; }
}
/** 0.13.2：清掉上一张卡的报表 → 按新卡重建 → 立即重绘面板 */
function refreshReport(delay) {
    const run = () => {
        try {
            lastReport = null; lastCoverage = null;
            const total = (chat && chat.length) || 0;
            if (total) {
                let id = total - 1;
                for (let i = total - 1; i >= 0; i--) { if (chat[i] && !chat[i].is_user) { id = i; break; } }
                buildReport(id, { log: false });
            }
            renderStats();
        } catch (_) {}
    };
    if (delay) setTimeout(run, delay); else run();
}
/** 0.13.2：切卡看门狗（ST 切角色不一定发 CHAT_CHANGED，所以事件 + 定时都查一次） */
function watchCard() {
    try {
        const k = cardKeyNow();
        if (!k || k === cardKey) return false;
        cardKey = k;
        invalidateProfile();
        lastSeen.clear();
        varRepairTried.clear();
        applyVarBar();
        refreshReport(0);
        setTimeout(() => { try { updatePromptInjection(); renderStats(); } catch (_) {} }, 500);
        setTimeout(() => { try { checkPatchApplied((chat && chat.length) ? chat.length - 1 : 0, { notify: false }); } catch (_) {} }, 2000);
        return true;
    } catch (_) { return false; }
}

/** 返回 true 表示文本被修改并已重渲染 */
function guardMessage(messageId, { rerender = true } = {}) {
    const s = settings();
    if (!s?.enabled || messageId == null) return false;
    const m = chat?.[messageId];
    if (!m || m.is_user || typeof m.mes !== 'string') return false;
    const profile = profileOf();
    let base = m.mes;
    let changed = false;
    let forceRerender = false;   // 0.8.0：括号刚修好的楼层必须重渲染，否则卡的正则没机会产出图片/面板
    // ⓪ 0.6.1：消息被卡的「整条接管」型前端界面认领（如「归真纪元」的 <开局面板> 正则 /^\s*【…】\s*$/）——
    //    这类消息一个字符都不能动：补个锚点就会让 $ 失配，那整块前端面板会直接不渲染（实测「开始新聊天后开局面板消失」）
    const anchoredView = anchoredViewConsuming(profile.views, base);
    if (anchoredView) {
        log('anchored-view-skip', anchoredView.name, '这条消息由卡的前端界面整体接管，已跳过全部改写');
        return false;
    }
    // ① 先清理「本卡未声明、也没人渲染」的块（v0.2.7 误插进 strictCheckMessage，实际从未生效）
    if (s.stripUndeclared) {
        const declared = new Set([...(profile.anchors || []), ...(profile.dataTags || []), ...(profile.hideTargets || []), ...(profile.strippers || []), ...(profile.rawTags || [])]);
        // 0.19.0：把世界书条目的 comment / keys 作为「条目名」传进去 —— 实测 95 张卡里有 78 张的正文会写成
        // <条目名>设定…</条目名>（模型回显世界书原文），旧实现把这些条目名当「未声明块」删掉，属于误伤。
        const sr = stripUndeclaredBlocks(base, { declared: declared, keep: KEEP_BLOCKS, bookTitles: profile.bookTitles || [], knownFields: (profile.required || []).map((x) => (x && x.path) || '') });
        if (sr.removed.length) {
            base = sr.text;
            changed = true;
            stats.blocksStripped += sr.removed.length;
            strippedByFloor.set(messageId, { tags: sr.removed.map((r) => r.tag), chars: sr.removed.reduce((a, b) => a + b.chars, 0) });
            while (strippedByFloor.size > 200) strippedByFloor.delete(strippedByFloor.keys().next().value);
            log('undeclared-block-stripped', sr.removed.map((r) => r.tag).join(','), '共 ' + sr.removed.reduce((a, b) => a + b.chars, 0) + ' 字（本卡未声明，会以原文裸露）');
        if (sr.keptTooBig && sr.keptTooBig.length) {
            stats.keptTooBig = (stats.keptTooBig || 0) + sr.keptTooBig.length;
            log('undeclared-too-big', sr.keptTooBig.map((x) => x.tag + ':' + x.chars + '字').slice(0, 4).join(','), '单块超过 1200 字，**不自动清理**（只报告；怕删掉你要的长内容）');
        }
        if (sr.keptAsTable && sr.keptAsTable.length) {
            stats.keptAsTable = (stats.keptAsTable || 0) + sr.keptAsTable.length;
            log('undeclared-kept-as-table', sr.keptAsTable.slice(0, 6).join(','), '这些块的内容包含本卡字段名，判定为变量表，**不清理**');
        }
        if (sr.keptAsTitle && sr.keptAsTitle.length) {
            stats.keptAsTitle = (stats.keptAsTitle || 0) + sr.keptAsTitle.length;
            log('undeclared-kept-as-title', sr.keptAsTitle.slice(0, 6).join(','), '这些是同名世界书条目，按设置**不清理**（避免误删条目名/卡片自己的容器）');
        }
        }
        if (sr.unclosed.length) {
            stats.unclosedBlocks += sr.unclosed.length;
            log('unclosed-block', sr.unclosed.join(','), '只有开标签，未自动删（怕误伤半截 HTML）');
        }
    }
    const res = guardText(base, profile, s);
    // 续写（Continue）会在同一条消息尾部追加，可能追加出第二个占位符 → 合并掉
    if (s.dedupeAnchor) {
        const dd = dedupeSelfClosingAnchors(res.text, profile.anchors || []);
        if (dd.removed.length) { res.text = dd.text; stats.duplicatesCollapsed += dd.removed.length; log('anchor-duplicate-merged', dd.removed.join(',')); changed = true; }
    }
    // P2 ⑦ 多块记账：同一条回复里出现多个结构块（重复输出 / 正文一份结尾一份）
    const bp = blockPresence(res.text, [...(profile.dataTags || []), ...(profile.anchors || [])]);
    if (bp.duplicates.length) {
        stats.multiBlocks += bp.duplicates.length;
        log('multi-block', bp.duplicates.map((b) => b.tag + '×' + (b.pairs + b.selfs)).join(','), '同一条回复里有多个同名结构块（只有最后一个通常生效）');
    }
    // 0.3.0 结构级修复：见 logic.js repairYamlStructure（列表项行内映射 + 更深兄弟键 / 引号后跟「, 文字」）
    if (s.fixYamlStructure !== false) {
        const ys = repairYamlStructure(res.text, [...(profile.dataTags || []), ...(profile.anchors || [])]);
        if (ys.fixes.length) {
            res.text = ys.text;
            stats.yamlStructFixed += ys.fixes.length;
            log('yaml-structure-fixed', ys.fixes.map((f) => f.tag + ':' + f.key).join(','), 'YAML 结构级修复：' + ys.fixes.map((f) => f.kind).join(' / '));
            changed = true;
        }
    }
    // 结构块 YAML 预检 + 修复：见 logic.js guardBlockYaml（引号错配 / 未加引号却含「: 」「 #」的值）
    const yg = guardBlockYaml(res.text, [...(profile.dataTags || []), ...(profile.anchors || [])], {
        fixSmartQuotes: s.fixSmartQuotes !== false,
        quoteScalars: s.quoteScalars !== false,
    });
    if (yg.fixes.length) {
        res.text = yg.text;
        const quotes = yg.fixes.filter((f) => f.kind === 'quote');
        const scalars = yg.fixes.filter((f) => f.kind === 'quote-scalar');
        if (quotes.length) { stats.quotesFixed += quotes.length; log('quote-repaired', quotes.map((f) => f.tag + ':' + f.key).join(','), '中文引号结尾 → 英文引号（否则 YAML 解析失败）'); }
        if (scalars.length) { stats.scalarsQuoted += scalars.length; log('scalar-quoted', scalars.map((f) => f.tag + ':' + f.key).join(','), '值含「: 」或「 #」已自动加引号'); }
        changed = true;
    }
    if (yg.issues.length) {
        stats.yamlIssues += yg.issues.length;
        log('block-yaml-issue', yg.issues.map((i) => i.tag + ':' + i.key).join(','), yg.issues[0].reason + '（已报告，未自动修改）');
    }
    // 畸形结束标签（如 </status!  缺 >）→ 补上，避免卡片正则匹配不到
    const norm = normalizeMalformedClosings(res.text, [...(profile.anchors || []), ...(profile.dataTags || [])]);
    if (norm.fixed.length) { res.text = norm.text; log('malformed-close-fixed', norm.fixed.join(',')); changed = true; }
    // 串卡检测：消息里出现「别的角色卡」的协议标签 → 只报告
    const foreign = detectForeignTags(res.text, profile);
    if (foreign.length) { stats.foreignTags++; log('foreign-tags', foreign.join(','), '检测到其他角色卡的协议标签（预设/历史串味）'); }
    for (const a of res.actions) {
        if (a.type === 'anchor-injected') { stats.anchorInjected++; log('anchor-injected', a.tag); changed = true; }
        else if (a.type === 'anchor-close-repaired') { stats.closeRepaired++; log('anchor-close-repaired', a.tag); changed = true; }
        else if (a.type === 'data-close-repaired') { stats.closeRepaired++; log('data-close-repaired', a.tag); changed = true; }
        else if (a.type === 'bracket-tag-fixed') { stats.bracketFixed++; log('bracket-tag-fixed', a.tag, '模型把尖括号写成了全角方括号，已改回 <Tag>，卡的渲染正则现在匹配得上'); changed = true; forceRerender = true; }
        else if (a.type === 'data-missing') { stats.dataMissing++; log('data-missing', a.tag, '本轮面板数据不会更新'); }
        else if (a.type === 'anchor-missing') { log('anchor-missing', a.tag, '未补（关闭了补锚点或该标签在隐藏白名单）'); }
    }
    try {
        const s2 = settings();
        s2.runCount = (s2.runCount || 0) + 1;
        s2.lastRunAt = new Date().toISOString();
        s2.lastRun = { id: messageId, changed: changed, actions: res.actions.map((a) => a.type + ':' + a.tag).slice(0, 8), card: (() => { try { const ctx = getContext(); return ctx?.characters?.[ctx?.characterId]?.name || ''; } catch (_) { return ''; } })() };
        saveSettingsDebounced();
    } catch (_) {}
    if (changed) {
        m.mes = res.text;
        stats.guarded++;
        lastSeen.set(messageId, m.mes);
        try { saveChatDebounced(); } catch (_) {}
        if (rerender || forceRerender) {
            stats.rerendered++;
            try { updateMessageBlock(messageId, m, { rerenderMessage: true }); } catch (e) { log('rerender-failed', '', String(e?.message || e)); }
            nudgeRender(messageId);
            setTimeout(() => checkNudgeApplied(messageId), 1500);
        }
    }
    // 变量 patch 覆盖度 + 路径白名单（P1 ② / P2 ⑤ / P2 ⑥）
    // 0.13.2：报表构建抽成 buildReport()，切卡时也能立即重建（旧版切卡后会一直显示上一张卡的表）
    try {
        buildReport(messageId);
        const hasBlock = m.mes.includes('<UpdateVariable>');
        // P1 ③ 连续多楼缺变量块 → 一次气泡（10 分钟内不重复）
        const declaresVars = (profile.dataTags || []).length > 0;
        if (declaresVars && !hasBlock) hardFailStreak++; else hardFailStreak = 0;
        if (declaresVars && !hasBlock && s.toastOnFail && hardFailStreak >= 3 && (Date.now() - lastToastAt) > 10 * 60 * 1000) {
            lastToastAt = Date.now();
            toast(T('toastNoVars', { n: hardFailStreak }), 'warning');
        }
    } catch (_) {}
    // 0.5.0：本卡声明的「格式标签」本轮有没有出现（只报告，不自动补内容 —— 实测 10 张卡只有格式标签可管）
    try {
        if (s.reportFormatTags !== false) {
            const used = new Set([...(profile.dataTags || []), ...(profile.anchors || [])]);
            const want = (profile.rawTags || []).filter((t) => !KEEP_BLOCKS.has(t) && !KEEP_BLOCKS.has(String(t).toLowerCase()) && !used.has(t));
            const miss = want.filter((t) => !m.mes.includes('<' + t));
            if (want.length && miss.length) {
                stats.formatMissing += miss.length;
                log('format-tag-missing', miss.join(','), '本卡声明的格式标签本轮没出现（只提示，不自动补）');
            }
        }
    } catch (_) {}
    try { if (s.yamlStrict) strictCheckMessage(messageId); } catch (_) {}
    try { if (s.mvuVerify) setTimeout(() => mvuVerifyMessage(messageId), 0); } catch (_) {}
    try { if (settings().autoFixVars) setTimeout(() => maybeFixVars(messageId), 0); } catch (_) {}

    if (s.notifyStale) {
        const st = isStale(chat[messageId - 1]?.mes, m.mes);
        if (st.stale) { stats.staleWarned++; log('data-stale', 'freshness', JSON.stringify(st.fields || {}).slice(0, 140)); }
    }
    return changed;
}
/** 渲染后校验：消息区里是否还残留未渲染的锚点/数据标签（说明卡脚本没接管） */
function verifyRendered(messageId) {
    try {
        const el = document.querySelector('#chat .mes[mesid="' + messageId + '"] .mes_text');
        if (!el) return;
        const profile = profileOf();
        const tags = [...(profile.anchors || []), ...(profile.dataTags || [])];
        const txt = el.textContent || '';
        const leaking = tags.filter((t) => txt.includes('<' + t) || txt.includes('</' + t + '>'));
        if (leaking.length) { stats.unrendered++; log('anchor-unrendered', leaking.join(','), '卡脚本未接管（可能需要酒馆助手变量或该卡未启用对应脚本）'); }
    } catch (_) {}
}
/** 0.9.2：本楼前端块自检 —— 卡的正则产出的前端块有没有被酒馆助手渲染成面板 */
let frontAlerted = new Set();
function checkFrontBlocks(messageId, opts) {
    try {
        const mesEl = document.querySelector('#chat .mes[mesid="' + messageId + '"]');
        const m = chat && chat[messageId];
        if (!mesEl || !m) return null;
        // 酒馆助手自己的判定原样搬过来：pre 的文本含 html> / <head / <body 之一
        const pres = Array.from(mesEl.querySelectorAll('.mes_text pre'));
        const fronts = pres.filter((p) => ['html>', '<head', '<body'].some((k) => String(p.textContent || '').includes(k)));
        let rendered = 0;
        for (const p of fronts) {
            const holder = p.closest('div.TH-render') || p.parentElement;
            const hasBox = !!p.closest('div.TH-render');
            const hasFrame = !!(holder && holder.querySelector('iframe'));
            if (hasBox || hasFrame) rendered++;
        }
        const collapsed = mesEl.querySelectorAll('.TH-collapse-code-block-button').length;
        const fence = String.fromCharCode(96).repeat(3);
        const fences = String(m.mes || '').split(fence).length - 1;
        const r = frontBlockVerdict({ front: fronts.length, rendered: rendered, collapsed: collapsed, fences: fences });
        const box = document.getElementById('cc-front');
        if (box) {
            box.textContent = (r.level === 'none') ? T('frontNone')
                : (T('frontHit') + ' ' + r.front + ' ｜ ' + T('frontRendered') + ' ' + r.rendered + (r.collapsed ? (' ｜ ' + T('frontCollapsed') + ' ' + r.collapsed) : '') + ' — ' + T('front_' + r.level));
        }
        if (r.level === 'unrendered' || r.level === 'partial' || r.level === 'collapse') {
            if ((!opts || opts.notify !== false) && !frontAlerted.has(messageId)) {
                frontAlerted.add(messageId);
            capSet(frontAlerted);
                log('front-blocks', r.level + ' front=' + r.front + ' rendered=' + r.rendered + ' collapsed=' + r.collapsed, '本楼前端块没渲染出来');
                toast(T('front_' + r.level), 'warning');
            }
        }
        return r;
    } catch (_) { return null; }
}
/** 0.9.4：读某一楼的 stat_data（MVU 存在 message.variables[swipe]，靠酒馆助手的 getVariables 取） */
function mvuVarsOf(id) {
    try {
        const th = window.TavernHelper || window.Tavernhelper;
        const fn = (th && typeof th.getVariables === 'function') ? th.getVariables.bind(th) : (typeof window.getVariables === 'function' ? window.getVariables : null);
        if (!fn) return null;
        const v = fn({ type: 'message', message_id: id });
        return (v && v.stat_data) || null;
    } catch (_) { return null; }
}
/** 0.9.4：本轮的变量补丁到底生效了没 —— 对比该楼与上一楼的 stat_data（实测病灶：补丁合法但 MVU 没应用） */
let applyAlerted = new Set();
function checkPatchApplied(messageId, opts) {
    try {
        const m = chat && chat[messageId];
        if (!m || m.is_user || typeof m.mes !== 'string') return null;
        const blocks = extractUpdateBlocks(m.mes);
        const ops = blocks.reduce((n, b) => n + ((parsePatchOps(b.patchText || b.block).ops || []).length), 0);
        const hasBlock = blocks.length > 0;
        const hasPatch = /<JSONPatch\b/i.test(m.mes);
        let prev = null;
        for (let i = messageId - 1; i >= 0; i--) { const v = mvuVarsOf(i); if (v) { prev = v; break; } }
        const cur = mvuVarsOf(messageId);
        const r = patchApplyVerdict({ hasBlock: hasBlock, hasPatch: hasPatch, ops: ops, hasStates: !!(prev && cur), sameState: !!(prev && cur) && stableStringify(prev) === stableStringify(cur) });
        // 0.11.0 状态级核对：面板的 ✅ 只说明「文本写了」，这里回答「变量真的变了没」（用户实测：一排 ✅ 但状态栏不动）
        let sd = null;
        try {
            const sameFloor = !!(lastReport && lastReport.id === messageId);
            const req = sameFloor ? (lastReport.required || []) : (profileOf().required || []);
            const cov = sameFloor ? (lastReport.covered || []) : [];
            // 本楼整体有没有推进：没推进（补丁没生效）时，「写了却没变」才是病灶；推进了只是「写的值本来就一样」
            const floorApplied = !!(prev && cur) && stableStringify(prev) !== stableStringify(cur);
            sd = stateDiffFields(cur, prev, req, cov, { applied: floorApplied });
            if (sameFloor) lastReport.state = sd;
            if (!sd.noBase && sd.stuck.length) {
                stats.varStuck = (stats.varStuck || 0) + sd.stuck.length;
                log('var-stuck', sd.stuck.length + ' 字段', '模型写了但存储值没变（状态栏不会更新）：' + sd.stuck.slice(0, 4).join('、'));
            }
        } catch (_) {}
        const box = document.getElementById('cc-apply');
        if (box) {
            box.textContent = T('applyHint') + '：' + T('apply_' + r.level) + (ops ? ('（' + ops + ' ops）') : '')
                + ((sd && !sd.noBase) ? ('　' + T('stateSummary') + ' ' + sd.advanced.length + '/' + (sd.advanced.length + sd.stuck.length + sd.same.length + sd.absent.length)) : '');
        }
        try { renderCoverageTable(); } catch (_) {}
        if (r.level === 'not-applied' || r.level === 'no-patch') {
            if ((!opts || opts.notify !== false) && !applyAlerted.has(messageId)) {
                applyAlerted.add(messageId);
            capSet(applyAlerted);
                log('mvu-apply', r.level + ' ops=' + ops, '本轮的变量补丁没有生效（状态栏不会更新）');
                toast(T('apply_' + r.level), 'warning');
            }
        }
        // 0.11.0：确认「补丁没生效」就自动幂等重算一次（不依赖 MVU；重放幂等，不会二次累加 delta）。
        // MVU 不在场时，哪怕整体判定 applied，只要有个别字段「写了没变」也修 —— 这时没有 MVU 的原生逻辑可撞。
        // MVU 在场且整体 applied 时不动手：卡的 transform 可能算出我们复刻不了的派生值，宁可只提示、让用户点按钮。
        const stuckNow = !!(sd && !sd.noBase && sd.stuck.length);
        if ((r.level === 'not-applied' || (stuckNow && !mvuActive())) && (!opts || opts.repair !== false)) scheduleVarRepair(messageId);
        return r;
    } catch (_) { return null; }
}
/* ── 0.10.0：变量兜底引擎（不依赖 MVU）────────────────────────────
 * 思路：MVU 不在（或被关）时，card-compat 自己当引擎 —— 从卡的 [InitVar] 建初值，
 * 逐楼解析 <JSONPatch> / _.set(...) 并应用，再把结果写回酒馆助手的变量，
 * 卡自己的状态栏模板（读 all_variables.stat_data）就会更新。
 * 手动模式（MVU 在但某楼补丁没生效）只在你点按钮时执行一次，避免 delta 二次累加。
 */
function thApi() { try { return window.TavernHelper || window.Tavernhelper || null; } catch (_) { return null; } }
/** MVU 是否在运行（在就不自动接管） */
function mvuActive() {
    try {
        if (settings().varAuto === false) return false;
        // 与 mvuApi() 同口径：MVU 在 iframe 内运行时是挂在 window.parent 上的（只认 window.MVU/Mvu 会把「在场」误判成「不在场」→ 自动兜底与 MVU 抢写、delta 二次累加）
        if (mvuApi()) return true;
        if (typeof window.MVU !== 'undefined' || typeof window.Mvu !== 'undefined') return true;
        const ctx = getContext();
        const ch = ctx && ctx.characters && ctx.characters[ctx.characterId];
        const scripts = (ch && ch.data && ch.data.extensions && ch.data.extensions.tavern_helper && ch.data.extensions.tavern_helper.scripts) || [];
        return scripts.some((s) => /MagVarUpdate|mvu/i.test(String(s.name || '') + ' ' + String(s.content || '')));
    } catch (_) { return false; }
}
/** 取当前卡的 [InitVar] 条目并解析成 stat_data 初值 */
function initVarOfCard() {
    try {
        const ctx = getContext();
        const ch = ctx && ctx.characters && ctx.characters[ctx.characterId];
        const entries = (ch && ch.data && ch.data.character_book && ch.data.character_book.entries) || [];
        const iv = entries.find((e) => /initvar/i.test(String(e.comment || '')));
        if (!iv) return null;
        const parsed = parseInitVar(iv.content || '');
        return Object.keys(parsed).length ? parsed : null;
    } catch (_) { return null; }
}
/** 0.11.0：变量作用域（风险 3）—— message（MVU 同款，默认）/ chat / character，由 detectVarScope 从卡的脚本与世界书推断 */
function scopeOpts(scope, id) {
    const sc = scope || 'message';
    if (sc === 'chat') return { type: 'chat' };
    if (sc === 'character') return { type: 'character' };
    return { type: 'message', message_id: id };
}
function readStateOf(id, scope) {
    try { const th = thApi(); if (!th || typeof th.getVariables !== 'function') return null; const v = th.getVariables(scopeOpts(scope, id)); return (v && v.stat_data) || null; } catch (_) { return null; }
}
function writeStateOf(id, statData, scope) {
    try {
        const th = thApi();
        const opt = scopeOpts(scope, id);
        if (th && typeof th.updateVariablesWith === 'function') { th.updateVariablesWith((v) => { v.stat_data = statData; return v; }, opt); return true; }
        // 回退：replaceVariables 是「整体替换变量表」——只传 stat_data 会把 display_data/delta_data/initialized_lorebooks 等一起抹掉（且不可逆）
        // 所以先取全量、只改 stat_data、再写回；连 getVariables 都没有就宁可不写
        if (th && typeof th.replaceVariables === 'function' && typeof th.getVariables === 'function') {
            const cur = th.getVariables(opt) || {};
            const next = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? Object.assign({}, cur, { stat_data: statData }) : { stat_data: statData };
            th.replaceVariables(next, opt);
            return true;
        }
    } catch (e) { log('var-write-failed', '', String((e && e.message) || e)); }
    return false;
}
function rerenderFloor(id) {
    try { const th = thApi(); if (th && typeof th.refreshOneMessage === 'function') { th.refreshOneMessage(id); return; } } catch (_) {}
    try { updateMessageBlock(id, chat[id], { rerenderMessage: true }); nudgeRender(id); } catch (_) {}
}
/** 这一楼的补丁操作（<JSONPatch> + _.set 命令式） */
function opsForMessage(mes) {
    const ops = [];
    const blocks = extractUpdateBlocks(mes);
    let wrapped = 0;
    for (const b of blocks) { const parsed = parsePatchOps(b.patchText || b.block); wrapped += (parsed.wrapped || 0); for (const op of (parsed.ops || [])) ops.push(op); }
    // 0.21.3：模型把路径写成 ${/a/b} 时，旧版整条 op 静默失效（实测整楼全灭）—— 这里报出来
    if (wrapped) {
        stats.pathWrapped = (stats.pathWrapped || 0) + wrapped;
        log('path-wrapper-unwrapped', wrapped + ' 条', '路径原本被 ${} / {{}} 包裹，已还原为标准 JSON Pointer（旧版会整条跳过）');
    }
    for (const op of parseSetCommands(mes)) ops.push(op);
    return ops;
}
/** 把某一楼的补丁应用进变量（A 自动 / B 手动都走这里） */
async function applyFloorVars(messageId, opts) {
    try {
        const m = chat && chat[messageId];
        if (!m || m.is_user || typeof m.mes !== 'string') return null;
        const ops = opsForMessage(m.mes);
        if (!ops.length) { if (!opts || opts.silent !== true) toast(T('varNoOps'), 'info'); return { applied: 0, skipped: [], reason: 'no-ops' }; }
        const sc = varScope();
        let base = readStateOf(messageId - 1, sc.scope);
        let baseFrom = T('varBasePrev');
        if (!base) {
            const iv = initVarOfCard();
            if (iv) { base = iv; baseFrom = T('varBaseInit'); } else { toast(T('varNoBase'), 'warning'); return { applied: 0, skipped: [], reason: 'no-base' }; }
        }
        const h0 = schemaHintsOfCard();
        const r = applyVarOps(base, ops, { clamps: h0.clamps, bounds: h0.bounds, types: h0.types, enums: h0.enums, objects: h0.objects, defaults: h0.defaults, ints: h0.ints, catches: h0.catches, rounds: h0.rounds, coerces: h0.coerces, overdraftGuard: settings().overdraftGuard !== false, schemaGuard: settings().schemaGuard !== false });
        const ok = writeStateOf(messageId, r.state, sc.scope);
        if (!ok) { toast(T('varWriteFail'), 'warning'); return { applied: 0, skipped: r.skipped, reason: 'write-failed' }; }
        rerenderFloor(messageId);
        log('var-applied', r.applied.length + ' ops（' + baseFrom + '）', '跳过 ' + r.skipped.length + ' 个：' + r.skipped.slice(0, 4).map((s) => s.path + '(' + s.reason + ')').join('、'));
        if (!opts || opts.toast !== false) toast(T('varApplied') + '：' + r.applied.length + ' / ' + ops.length, r.skipped.length ? 'warning' : 'success');
        return { applied: r.applied.length, skipped: r.skipped, reason: 'ok' };
    } catch (e) { log('var-apply-failed', '', String((e && e.message) || e)); return null; }
}
/* ── 0.11.0：幂等重算引擎（正面解决三个风险）──────────────────────
 * 旧 A 路（applyFloorVars）用「上一楼的 stat_data」当基线逐楼应用。MVU 一旦漏应用某一楼，
 * 之后每一楼都建在错误基线上，delta 还会被反复累加 —— 这就是「状态栏部分数据不更新」修不好的原因。
 * 新 A 路：以 [InitVar] 为唯一初值，按楼层顺序把每层的补丁重放一遍，算出「每层本该有的 stat_data」再写回。
 * 重放是纯函数且幂等：同一批补丁跑多少次结果都一样，所以 MVU 在场时也能安全自动修。
 */
let schemaCache = null, schemaCacheKey = '';
let scopeCache = null, scopeCacheKey = '';
/** 当前卡的脚本 + 世界书全文（schema 与作用域都从这里推断；按角色换卡自动失效） */
function cardScriptText() {
    try {
        const ctx = getContext();
        const ch = ctx && ctx.characters && ctx.characters[ctx.characterId];
        const parts = [];
        const st = (ch && ch.data && ch.data.extensions && ch.data.extensions.tavern_helper) || {};
        for (const s of (Array.isArray(st.scripts) ? st.scripts : [])) parts.push(String((s && s.content) || ''));
        const entries = (ch && ch.data && ch.data.character_book && ch.data.character_book.entries) || [];
        for (const e of entries) parts.push(String((e && e.content) || ''));
        return { key: String((ch && (ch.avatar || ch.name)) || (ctx && ctx.characterId) || ''), text: parts.join(String.fromCharCode(10)) };
    } catch (_) { return { key: '', text: '' }; }
}
/** 卡的 MVU Zod schema → 夹取规则与类型（风险 2：对齐 MVU 的 z.coerce + _.clamp，避免超界/字符串数字） */
function schemaHintsOfCard() {
    try {
        const c = cardScriptText();
        if (schemaCache && schemaCacheKey === c.key) return schemaCache;
        const r = schemaHints(c.text);
        schemaCache = r; schemaCacheKey = c.key;
        return r;
    } catch (_) { return { clamps: [], types: [] }; }
}
/** 模板读的是哪个作用域，就写到哪个作用域（风险 3） */
function varScope() {
    try {
        const c = cardScriptText();
        if (scopeCache && scopeCacheKey === c.key) return scopeCache;
        const r = detectVarScope(c.text);
        scopeCache = r; scopeCacheKey = c.key;
        return r;
    } catch (_) { return { scope: 'message', reason: '' }; }
}
let replayRunning = false;
let varRepairTried = new Set();
let varRepairTimer = null;
/** 检测到「补丁没生效」后，延迟一小会儿自动修一次（同一楼只修一次，避免和 MVU 抢写） */
function scheduleVarRepair(messageId) {
    try {
        if (settings() && settings().compatMode) return false;
        if (settings() && settings().varRepair === false) return false;
        if (varRepairTried.has(messageId)) return false;
        varRepairTried.add(messageId);
        if (varRepairTimer) clearTimeout(varRepairTimer);
        varRepairTimer = setTimeout(() => {
            varRepairTimer = null;
            stats.varRepairAuto = (stats.varRepairAuto || 0) + 1;
            recomputeAllFloors({ silent: true, toast: false, auto: true });
        }, 1200);
        return true;
    } catch (_) { return false; }
}
/**
 * 只修「卡住」的楼层（策略见 logic.js 的 planFloorFixes）：
 * 以 MVU 的真实快照为基线，MVU 已应用的楼层**永不覆盖**；本楼的 delta 只加这一次（不二次累加）；
 * 我们解析不了的方言、MVU 自算的字段（时间流逝等）不会回退；MVU 完全不在场时才退回 [InitVar] 累积。
 * 幂等：修完再跑一遍，存值已变 → 不再写。
 * @param {{silent?:boolean, toast?:boolean, auto?:boolean, dryRun?:boolean}} [opts]
 */
async function recomputeAllFloors(opts) {
    const o = opts || {};
    const empty = { floors: 0, changed: 0, applied: 0, skippedFloors: [], scope: '', reason: '' };
    if (replayRunning) return Object.assign({}, empty, { reason: 'busy' });
    replayRunning = true;
    try {
        const s = settings();
        if (s && s.enabled === false) return Object.assign({}, empty, { reason: 'disabled' });
        if (s && s.compatMode && o.auto) return Object.assign({}, empty, { reason: 'compat-mode' });
        const total = (chat && chat.length) || 0;
        if (!total) return Object.assign({}, empty, { reason: 'no-chat' });
        const sc = varScope();
        const hints = schemaHintsOfCard();
        const iv = initVarOfCard();
        const floorOps = [], stored = [];
        for (let i = 0; i < total; i++) {
            const m = chat[i];
            floorOps.push((m && !m.is_user && typeof m.mes === 'string') ? opsForMessage(m.mes) : []);
            stored.push(readStateOf(i, sc.scope));      // MVU 的真实快照（拿不到就是 null）
        }
        if (!iv && !stored.some(Boolean)) {
            if (o.silent !== true) toast(T('varNoBase'), 'warning');
            return Object.assign({}, empty, { reason: 'no-base', scope: sc.scope });
        }
        const guardOn = !s || s.overdraftGuard !== false;
        const schemaOn = !s || s.schemaGuard !== false;
        // 0.12.1：把 schema 的全部约束交给引擎（类型/枚举/夹取/范围/对象/默认值）
        const plan = planFloorFixes(stored, floorOps, iv || {}, {
            clamps: hints.clamps, bounds: hints.bounds, types: hints.types, enums: hints.enums,
            objects: hints.objects, defaults: hints.defaults,
            ints: hints.ints, catches: hints.catches, rounds: hints.rounds, coerces: hints.coerces,
            overdraftGuard: guardOn, schemaGuard: schemaOn,
        });
        let written = 0, changed = 0, applied = 0;
        const skippedFloors = [], guardHits = [], negFixed = [], schemaHits = [];
        // C15：chat / character 作用域下每层读到的都是同一份共享变量，planFloorFixes 会把「所有含补丁的楼层」都判成要写，
        // 于是每次触发都把同一份数据重复写 N 遍（统计虚高、还可能和 MVU 抢）。这种情况只写最后一层。
        const sharedScope = sc.scope === 'chat' || sc.scope === 'character';
        let lastWriteIdx = -1;
        if (sharedScope) {
            for (let i = plan.length - 1; i >= 0; i--) { if (plan[i] && plan[i].write) { lastWriteIdx = i; break; } }
        }
        else { for (let i = plan.length - 1; i >= 0; i--) { if (plan[i] && plan[i].write) { lastWriteIdx = plan[i].index; break; } } }
        let sharedSkipped = 0;
        for (const p of plan) {
            if (p.guardHit && p.guardHit.length) guardHits.push({ index: p.index, paths: p.guardHit });
            if (p.negative && p.negative.length) negFixed.push({ index: p.index, paths: p.negative });
            if (p.schemaHits && p.schemaHits.length) for (const sh of p.schemaHits) schemaHits.push({ index: p.index, path: sh.path, reason: sh.reason });
            applied += p.applied;
            if (!p.write) continue;                                     // 无补丁 / MVU 已应用 / 已经是对的 → 不写
            if (p.ops && p.skipped && p.skipped.length >= p.ops) { skippedFloors.push(p.index); continue; }  // 路径全落空 → 宁可不写
            if (sharedScope && p.index !== lastWriteIdx) { sharedSkipped++; continue; }                     // 共享变量只写一次（最后一层）
            changed++;
            if (o.dryRun) continue;                                     // 试算模式：只统计不写（E2E / 排查用）
            if (writeStateOf(p.index, p.want, sc.scope)) written++;
        }
        if (guardHits.length) {
            stats.varGuard = (stats.varGuard || 0) + guardHits.reduce((n, g) => n + g.paths.length, 0);
            log('var-guard', guardHits.length + ' 层', T('varGuardHit') + '：' + guardHits.map((g) => '#' + g.index + ' ' + g.paths.join('、')).join('；'));
            if (o.toast !== false) toast(T('varGuardHit') + '：' + guardHits.map((g) => g.paths.join('、')).join('；'), 'warning');
        }
        if (schemaHits.length) {
            stats.varSchema = (stats.varSchema || 0) + schemaHits.length;
            log('var-schema', schemaHits.length + ' 处', T('varSchemaHit') + '：' + schemaHits.slice(0, 4).map((s) => '#' + s.index + ' ' + s.path + '（' + s.reason + '）').join('；'));
            if (o.toast !== false) toast(T('varSchemaHit') + '：' + schemaHits.length, 'warning');
        }
        if (negFixed.length) {
            stats.varNegFixed = (stats.varNegFixed || 0) + negFixed.length;
            log('var-negative', negFixed.length + ' 层', T('varNegFixed') + '：' + negFixed.map((g) => '#' + g.index + ' ' + g.paths.join('、')).join('；'));
        }
        if (written) {
            stats.varReplayRuns = (stats.varReplayRuns || 0) + 1;
            stats.varReplayFloors = (stats.varReplayFloors || 0) + written;
            let last = -1;
            for (let i = plan.length - 1; i >= 0; i--) { if (plan[i].write) { last = i; break; } }
            if (last >= 0) rerenderFloor(last);
            if (sharedSkipped) log('var-shared-scope', sharedSkipped + ' 层', 'chat/character 作用域共享同一份变量，只写最后一层（跳过重复写入）');
            log('var-replay', written + ' 层', '以 MVU 真实值为基线修「卡住」的楼层（补丁 ' + applied + ' 个操作）；范围 ' + sc.scope + (skippedFloors.length ? ('；' + skippedFloors.length + ' 层路径全落空已跳过') : ''));
            if (o.toast !== false) toast(T('varReplayOk') + '：' + written + ' ' + T('varReplayFloors'), skippedFloors.length ? 'warning' : 'success');
            // 0.13.1：本卡若有 transform/refine 这类无法离线校验的约束，写变量这一刻明确告知（不只在面板里躺着）
            const unver = (hints.unverifiable || []);
            if (unver.length) {
                const note = T('varUnverified', { n: unver.length, kinds: unverKinds(unver) });
                log('var-unverified', unver.length + ' 处', note);
                if (o.toast !== false) toast(note, 'warning');
            }
        } else if (!o.dryRun && o.toast !== false && o.silent !== true) {
            toast(T('varReplayNone'), 'info');
        }
        if (o.dryRun && changed) log('var-replay-dry', changed + ' 层', '试算：这些楼层的变量需要修复（未写入）');
        return { floors: written, changed: changed, applied: applied, skippedFloors: skippedFloors, guardHits: guardHits, negFixed: negFixed, schemaHits: schemaHits, scope: sc.scope, reason: 'ok', dryRun: !!o.dryRun, plan: plan.map((p) => ({ index: p.index, ops: p.ops, write: p.write, reason: p.reason, negative: p.negative || [], guardHit: p.guardHit || [], schemaHits: p.schemaHits || [] })) };
    } catch (e) { log('var-replay-failed', '', String((e && e.message) || e)); return Object.assign({}, empty, { reason: 'error' }); }
    finally { replayRunning = false; }
}
/** 输入框功能按钮（照剧情推进插件的做法：prepend 进 #send_form） */
function ensureVarBar() {
    let bar = document.getElementById('cc-var-bar');
    if (bar) return bar;
    const form = document.getElementById('send_form');
    if (!form) return null;
    bar = document.createElement('div');
    bar.id = 'cc-var-bar';
    const b = document.createElement('div');
    b.id = 'cc-var-apply';
    b.className = 'ccv-btn';
    b.textContent = T('varApplyBtn');
    b.addEventListener('click', async () => {
        // 0.11.0：按钮 = 「只修没生效的楼层」。MVU 在场时先确认一次（会写入变量，用户要知情）。
        // 注意：ST 页面里没有 showConfirm 这个全局函数 —— 0.10.0 用它导致点击时抛 ReferenceError、
        // 表现就是「点了没反应」（用户实测反馈）。改用 ST 自己的 callGenericPopup(POPUP_TYPE.CONFIRM)，
        // 并且整段包 try/catch，任何异常都会弹出来，不再静默失败。
        try {
            // 先试算一次：没有再给出即时反馈（点了必有反应），有问题才弹确认框
            const dry = await recomputeAllFloors({ dryRun: true, silent: true, toast: false });
            if (dry && dry.reason === 'busy') { toast(T('varBusy'), 'info'); return; }
            const need = (dry && dry.changed) || 0;
            if (!need) {
                log('var-check', '0 层', '所有楼层的补丁都已生效，无需修复');
                toast(T('varReplayNone'), 'info');
                return;
            }
            const sc = varScope();
            const unver = (schemaHintsOfCard().unverifiable || []);
            const caveat = unver.length ? ('<br><br>' + escHtml(T('varUnverified', { n: unver.length, kinds: unverKinds(unver) }))) : '';
            const ok = await callGenericPopup('<b>' + escHtml(T('varApplyBtn')) + '</b><br>' + escHtml(T('varReplayTitle')) + '<br>' + escHtml(T('varReplayFloors') + '：' + need + '（' + T('varScopeMsg') + '：' + sc.scope + '）') + '<br><br>' + escHtml(T('varMvuWarn')) + caveat, POPUP_TYPE.CONFIRM, '', { okButton: T('varApplyBtn'), cancelButton: T('close') });
            if (!ok) return;
            const r = await recomputeAllFloors({});
            if (r && r.reason === 'busy') toast(T('varBusy'), 'info');
        } catch (e) {
            log('var-btn-failed', '', String((e && e.message) || e));
            toast(T('varWriteFail') + String((e && e.message) || e), 'warning');
        }
    });
    bar.appendChild(b);
    form.prepend(bar);
    log('var-bar-injected', '', '变量兜底按钮已注入发送栏');
    return bar;
}
function applyVarBar() {
    try {
        const s = settings();
        if (!s || !s.enabled || s.varBar === false) { const old = document.getElementById('cc-var-bar'); if (old) old.remove(); return; }
        const bar = ensureVarBar();
        if (!bar) return;
        const btn = document.getElementById('cc-var-apply');
        if (btn) {
            const auto = s.varAuto !== false;
            const mode = !auto ? T('varModeOff') : (mvuActive() ? T('varModeMvu') : T('varModeFallback'));
            btn.title = T('varApplyBtn') + '：' + T('varReplayTitle') + '（' + mode + '）';
            btn.textContent = T('varApplyBtn') + ((auto && !mvuActive()) ? ' ·' : '');
        }
    } catch (_) {}
}
let varBarTimer = null;
function applyPanelFont() {
    try {
        const el = document.getElementById('cc-panel');
        // 0.19.1：默认 1.1（原 1 → 偏小），并且外面套 max(13.5px, …) 下限；用户已有设置值则沿用
        if (el) el.style.setProperty('--cc-font', String(Number(settings().panelFont) || 1.1) + 'em');
    } catch (_) {}
}
/** 启动/切聊天时扫描最近 N 楼：把「成对块 + 自闭合占位符」这类历史消息也规范化 */
function normalizeRecent() {
    try {
        const n = Number(settings()?.scanRecent) || 0;
        if (!n || !settings()?.enabled) return;
        const total = chat?.length || 0;
        const from = Math.max(0, total - n);
        const rerenderOld = settings()?.rerenderOldFloors === true;
        let idx = from;
        const step = () => {
            if (idx >= total) { log('auto-scan-done', '最近 ' + n + ' 楼' + (rerenderOld ? '' : '（历史楼层只改文本、不重渲染）')); return; }
            // 历史楼层默认不重渲染：ST 重建 .mes_text 会把酒馆助手画好的前端面板换回源码 pre 块，
            // 而酒馆助手只在刷新/加载历史时全量兜底；最新一楼仍重渲染并补发事件。
            try { guardMessage(idx, { rerender: rerenderOld || idx === total - 1 }); } catch (_) {}
            idx++;
            setTimeout(step, 120);
        };
        step();
    } catch (e) { console.error('[card-compat] normalizeRecent', e); }
}
/** P1 ② 面板对照表：本卡要求 vs 本轮实际 */
function renderCoverageTable() {
    const box = document.getElementById('cc-table');
    if (!box) return;
    const rep = lastReport;
    if (!rep) { box.innerHTML = '<div class="cc-muted">' + escHtml(T('noReport')) + '</div>'; return; }
    const parts = [];
    // 0.13.2：表头写明是哪张卡的表 —— 切卡后一眼能看出是不是还在显示旧卡
    if (rep.card) parts.push('<div class="cc-line cc-muted">' + escHtml(T('reportCard')) + '：<b>' + escHtml(rep.card) + '</b>' + (rep.id != null ? ('（' + escHtml(T('reportFloor')) + ' ' + rep.id + '）') : '') + '</div>');
    if (!(rep.required || []).length) {
        parts.push('<div class="cc-muted">' + escHtml(T('noRequired')) + '</div>');
        box.innerHTML = parts.join('');
        return;
    }
    // 0.11.0：新增第三列「变量是否真的变了」—— 旧表只有「文本写没写」（用户实测：一排 ✅ 但状态栏不动，检查不出来）
    parts.push('<table class="cc-tab"><thead><tr><th>' + escHtml(T('colField')) + '</th><th>' + escHtml(T('colDone')) + '</th><th>' + escHtml(T('colState')) + '</th></tr></thead><tbody>');
    const st = rep.state || null;
    // 0.13.2：有些卡的规则会让同一路径抽出来两次（实测 Science Worship…：角色.超现实形式/层级各重复一次）→ 渲染时去重，统计不受影响
    const seenRow = new Set();
    for (const f of (rep.required || [])) {
        if (!f || seenRow.has(f.path)) continue;
        seenRow.add(f.path);
        const ok = (rep.covered || []).indexOf(f.path) >= 0;
        // 0.16.1：占位形态（未登场/未描述 …）本来就不该更新 → 中性标记，不打红叉
        const isPending = !!(st && !st.noBase && (st.pending || []).indexOf(f.path) >= 0);
        let mark = '<span class="cc-muted">—</span>';
        const doneCell = isPending
            ? '<span class="cc-muted" title="' + escHtml(T('colPending')) + '">—</span>'
            : (ok ? '✅' : '❌');
        if (st && !st.noBase) {
            if ((st.advanced || []).indexOf(f.path) >= 0) mark = '✅';
            else if ((st.stuck || []).indexOf(f.path) >= 0) mark = '<span class="cc-warn" title="' + escHtml(T('stateStuck')) + '">⚠️</span>';
            else if ((st.same || []).indexOf(f.path) >= 0) mark = '<span class="cc-muted" title="' + escHtml(T('stateSame')) + '">➖</span>';
            else mark = '<span class="cc-muted" title="' + escHtml(T('stateAbsent')) + '">○</span>';
        }
        parts.push('<tr><td>' + escHtml(f.path) + '</td><td>' + doneCell + '</td><td>' + mark + '</td></tr>');
    }
    parts.push('</tbody></table>');
    // 0.17.0：把符号含义直接印在面板上（用户指出：解释了但没标注，面板上还是看不懂）
    const lgItem = (sym, cls, key) => '<span class="' + cls + '" title="' + escHtml(T(key)) + '">' + sym + '</span>' + escHtml(T(key + 'Short'));
    parts.push('<div class="cc-legend">'
        + '<b>' + escHtml(T('legendTitle')) + '</b> '
        + lgItem('✅', 'cc-ok', 'lgDone') + '　'
        + lgItem('❌', 'cc-bad', 'lgMiss') + '　'
        + lgItem('➖', 'cc-muted', 'lgSame') + '　'
        + lgItem('⚠️', 'cc-warn', 'lgStuck') + '　'
        + lgItem('○', 'cc-muted', 'lgNoBase') + '　'
        + lgItem('—', 'cc-muted', 'lgPlaceholder')
        + '</div>');
    if (st) {
        parts.push(st.noBase
            ? ('<div class="cc-line cc-muted">' + escHtml(T('stateNoBase')) + '</div>')
            : ('<div class="cc-line ' + ((st.stuck || []).length ? 'cc-warn' : 'cc-muted') + '"><b>' + escHtml(T('stateSummary')) + '</b>：' + ((st.pending || []).length ? (escHtml(T('stPending')) + ' ' + st.pending.length + ' ｜ ') : '') + escHtml(T('stChanged')) + ' ' + (st.advanced || []).length + ' ｜ ' + escHtml(T('stateStuck')) + ' ' + (st.stuck || []).length + ' ｜ ' + escHtml(T('stateAbsent')) + ' ' + (st.absent || []).length + ((st.same || []).length ? (' ｜ ' + escHtml(T('stateSame')) + ' ' + (st.same || []).length) : '') + ((st.stuck || []).length ? escHtml(T('stateStuckWarn')) : '') + '</div>'));
    }
    if (rep.ledger && rep.ledger.mismatches && rep.ledger.mismatches.length) {
        const bad = rep.ledger.mismatches.slice(0, 4).map((m) => ('#' + m.floor + ' 计划 ' + m.planned + ' / 实际 ' + (m.actual == null ? '?' : m.actual))).join('；');
        parts.push('<div class="cc-line cc-warn"><b>' + escHtml(T('ledgerWarn')) + '</b>：' + escHtml(bad) + escHtml(T('ledgerWarnTail')) + '</div>');
    }
    if (rep.table && rep.table.changes > 0 && rep.table.base) {
        const tbl = rep.table;
        const head = tbl.sample.map((c) => escHtml(c.path) + '：' + escHtml(String(c.from).slice(0, 10)) + ' → ' + escHtml(String(c.to).slice(0, 16))).join('<br>');
        parts.push('<div class="cc-line cc-warn"><b>' + escHtml(T('tableWarn')) + '</b>：' + escHtml(T('tableWarnBody', { tag: tbl.tag, n: tbl.changes })) + '<br>' + head + '<br>'
            + (tbl.fromSwipe ? ('<br>' + escHtml(T('tableFromSwipe'))) : '')
            + '<button class="menu_button cc-table-write" data-floor="' + escHtml(String(rep.id)) + '">' + escHtml(T('tableWriteBtn')) + '</button></div>');
    }
    if (rep.money && rep.money.missingCash) {
        const fix = (rep.fix && rep.fix.ok) ? rep.fix : null;
        if (fix) {
            const btns = fix.actions.map((a2, n) => '<button class="menu_button cc-money-fix" data-path="' + escHtml(a2.path) + '" data-delta="' + escHtml(String(a2.delta)) + '" data-floor="' + escHtml(String(rep.id)) + '">' + escHtml(T('moneyFixBtn', { who: a2.label, path: a2.path, delta: a2.delta })) + '</button>').join(' ');
            parts.push('<div class="cc-line cc-warn"><b>' + escHtml(T('moneyWarn')) + '</b>：' + escHtml(T('moneyFixOffer', { n: rep.money.n })) + '<br>' + btns + ' <button class="menu_button cc-money-undo">' + escHtml(T('moneyUndoBtn')) + '</button></div>');
        } else {
            parts.push('<div class="cc-line cc-warn"><b>' + escHtml(T('moneyWarn')) + '</b>：' + escHtml(T('moneyWarnBody', { n: rep.money.n, hint: rep.money.flow ? T('moneyHintFlow') : T('moneyHintNone') })) + '</div>');
        }
    }
    if (rep.stripped && rep.stripped.tags && rep.stripped.tags.length) parts.push('<div class="cc-line cc-warn"><b>' + escHtml(T('undeclaredRow')) + '</b>：' + escHtml(rep.stripped.tags.join('、')) + '（' + rep.stripped.chars + ' 字，本卡未声明，已按设置清理）</div>');
    if (rep.written && rep.written.length) parts.push('<div class="cc-line"><b>' + escHtml(T('wrotePaths')) + '</b>：' + escHtml(rep.written.join('、')) + '</div>');
    if (rep.unknownPaths && rep.unknownPaths.length) parts.push('<div class="cc-line cc-warn"><b>' + escHtml(T('unknownPaths')) + '</b>：' + escHtml(rep.unknownPaths.join('、')) + '</div>');
    if (rep.extraPaths && rep.extraPaths.length) parts.push('<div class="cc-line cc-muted"><b>' + escHtml(T('extraPaths')) + '</b>：' + escHtml(rep.extraPaths.join('、')) + '</div>');
    box.innerHTML = parts.join('');
}
/** 0.13.1：把 unverifiable 列表归纳成「种类 数量」（面板与写时提示共用） */
function unverKinds(list) {
    const m = {};
    for (const u of (list || [])) { const k = String((u && u.kind) || '?').split(':')[0]; m[k] = (m[k] || 0) + 1; }
    return Object.keys(m).map((k) => k + ' ' + m[k]).join('、');
}
/** 0.12.1：面板显示「卡的 Zod 结构解析到什么」+「有多少约束无法离线校验」（不静默） */
function renderSchemaLine() {
    const box = document.getElementById('cc-schema');
    if (!box) return;
    try {
        const h = schemaHintsOfCard();
        const n = (a) => (a || []).length;
        const head = T('schemaSummary') + '：' + T('schClamp') + ' ' + n(h.clamps) + ' ｜ ' + T('schBound') + ' ' + n(h.bounds) + ' ｜ ' + T('schType') + ' ' + n(h.types) + ' ｜ ' + T('schEnum') + ' ' + n(h.enums) + ' ｜ ' + T('schDefault') + ' ' + n(h.defaults) + ' ｜ ' + T('schObject') + ' ' + n(h.objects) + ' ｜ ' + T('schInt') + ' ' + n(h.ints) + ' ｜ ' + T('schCatch') + ' ' + n(h.catches) + ' ｜ ' + T('schRound') + ' ' + n(h.rounds);
        const un = h.unverifiable || [];
        box.className = 'cc-line' + (un.length ? ' cc-warn' : ' cc-muted');
        box.textContent = un.length
            ? (head + '　' + T('schemaUnverifiable') + ' ' + un.length + '：' + unverKinds(un) + (un[0] && un[0].path && un[0].path.length ? ('（如 ' + un[0].path.join('.') + '）') : ''))
            : (head + '　' + T('schemaAllCovered'));
    } catch (_) {}
}
function renderStats() {
    // 0.18.0（UI 优化）：原来是一长串「v0.17.0 ｜ 修正 0 次 ｜ 补锚点 0 ｜ …」—— 用户反馈看不懂重点。
    // 现在拆成 4 组芯片：常态数据默认中性色，只有出问题（>0 / 失败 / 覆盖不满）才转警告色，一眼能扫。
    const chip = (label, value, opts) => {
        const o = opts || {};
        const zeroNeutral = o.zeroNeutral !== false;
        const bad = o.bad === true || (zeroNeutral && Number(value) > 0 && o.goodWhenZero === true);
        return '<span class="cc-chip' + (bad ? ' cc-chip-warn' : '') + '"' + (o.title ? (' title="' + escHtml(o.title) + '"') : '') + '>'
            + '<i>' + escHtml(label) + '</i><b>' + escHtml(String(value)) + '</b></span>';
    };
    const chipsOf = (arr) => arr.filter(Boolean).join('');
    const box = document.getElementById('cc-stats');
    if (box) {
        const g1 = chipsOf([
            chip(T('stVersion'), 'v' + VERSION, { zeroNeutral: false }),
            chip(T('stFixes'), stats.guarded, { goodWhenZero: false }),
            chip(T('stRerender'), stats.rerendered, { goodWhenZero: false }),
        ]);
        const g2 = chipsOf([
            chip(T('stAnchor'), stats.anchorInjected, { goodWhenZero: true }),
            chip(T('stClose'), stats.closeRepaired, { goodWhenZero: true }),
            chip(T('stDataMiss'), stats.dataMissing, { goodWhenZero: true }),
            chip(T('stStale'), stats.staleWarned, { goodWhenZero: true }),
        ]);
        const g3 = chipsOf([
            chip(T('stDup'), stats.duplicatesCollapsed, { goodWhenZero: true }),
            chip(T('stBlocks'), stats.blocksStripped, { goodWhenZero: true }),
            chip(T('stUnclosed'), stats.unclosedBlocks, { goodWhenZero: true }),
            chip(T('stWrapped'), stats.pathWrapped || 0, { goodWhenZero: true, title: T('stWrappedTip') }),
            chip(T('stForeign'), stats.foreignTags, { goodWhenZero: true }),
        ]);
        const covRatio = lastCoverage ? (lastCoverage.total ? lastCoverage.covered.length / lastCoverage.total : 0) : 0;
        const covWarn = !!(lastCoverage && lastCoverage.total && lastCoverage.covered.length < lastCoverage.total);
        const g4 = chipsOf([
            chip(T('stCover'), lastCoverage ? (lastCoverage.covered.length + '/' + lastCoverage.total) : '—', { bad: covWarn, title: lastCoverage && lastCoverage.missing.length ? (T('stMissing') + '：' + lastCoverage.missing.slice(0, 6).join('、')) : '' }),
            chip(T('stMvuFail'), stats.mvuParseFail || 0, { goodWhenZero: true }),
            chip(T('stYamlStrict'), stats.yamlStrictFail || 0, { goodWhenZero: true }),
        ]);
        box.innerHTML = '<div class="cc-chips">' + g1 + '</div>' + '<div class="cc-chips">' + g2 + '</div>' + '<div class="cc-chips">' + g3 + '</div>' + '<div class="cc-chips">' + g4 + '</div>';
    }
    // 0.16.2：连续硬失败可见化（只列还在连续中的类别；计数跨楼层，换类别即清零）
    const failsBox = document.getElementById('cc-fails');
    if (failsBox) {
        const hot = Object.keys(failStreak).filter((k) => failStreak[k] > 0).map((k) => (T('fail_' + k) || k) + ' ×' + failStreak[k]);
        failsBox.textContent = hot.length ? (T('failRow') + '：' + hot.join(' ｜ ')) : '';
        failsBox.className = 'cc-line ' + (Object.keys(failStreak).some((k) => failStreak[k] >= 3) ? 'cc-warn' : 'cc-muted');
    }
    // 0.22.0：总开关状态一眼可见
    const ms = document.getElementById('cc-master-state');
    if (ms) {
        const on = (settings() || {}).enabled !== false;
        ms.textContent = on ? ('· ' + T('switchOn')) : ('· ' + T('switchOff'));
        ms.className = on ? 'cc-ok' : 'cc-bad';
    }
    const logBox = document.getElementById('cc-log');
    if (logBox) logBox.textContent = recent.map((r) => r.t + ' ' + r.type + ' ' + r.tag + (r.extra ? ' — ' + r.extra : '')).join(String.fromCharCode(10));
    renderTrend();
    // 0.16.4：这两项会**覆写卡自己的状态栏样式**（用户实测每张卡的美化都不同）→ 打开时明确警告
    const fw = document.getElementById('cc-font-warn');
    if (fw) {
        const s2 = settings() || {};
        const on = (Number(s2.fontZoom) || 1) !== 1 || Number(s2.fontFloor) > 0;
        fw.style.display = on ? '' : 'none';
        fw.textContent = on ? T('fontWarn') : '';
    }
    renderCoverageTable();
    renderMvuBox();
    renderSchemaLine();
    renderProtocolLine();
    refreshDepBox(false);
    renderScan();
}
/** P3 ⑨ 面板里的 MVU 状态块 */
/* ── 0.4.0：依赖状态 / 变量协议 / 兼容模式 ─────────────────────── */
const depCache = { at: 0, rows: null };
/** 探测三方版本与可用性：ST / 酒馆助手（读它的 manifest）/ MVU（window.Mvu） */
async function depStatus(force) {
    if (!force && depCache.rows && (Date.now() - depCache.at) < 60000) return depCache.rows;
    const rows = [];
    let stv = '';
    try { const ctx = getContext(); stv = String(ctx?.version || ctx?.VERSION || ''); } catch (_) {}
    if (!stv) { try { const res = await fetch('/version', { cache: 'no-cache' }); if (res && res.ok) { const j = await res.json(); stv = String(j.pkgVersion || j.version || ''); } } catch (_) {} }
    rows.push({ name: 'SillyTavern', version: stv || '未知', ok: true, note: '核心依赖（本扩展只依赖它）' });
    let th = { ok: false, version: '' };
    for (const id of ['JS-Slash-Runner', 'TavernHelper', 'tavern-helper']) {
        try {
            const res = await fetch('/scripts/extensions/third-party/' + id + '/manifest.json', { cache: 'no-cache' });
            if (res && res.ok) {
                const j = await res.json();
                if (j && (j.display_name || j.name)) { th = { ok: true, version: String(j.version || '?'), id: id }; break; }
            }
        } catch (_) {}
    }
    rows.push({ name: '酒馆助手（TavernHelper）', version: th.ok ? th.version : '未安装 / 读不到', ok: th.ok, note: th.ok ? '前端块渲染；本扩展只「补发事件」这一处联动' : '不影响守护功能，只是重渲染后可能需刷新页面' });
    const M = mvuApi();
    rows.push({ name: 'MVU', version: M ? String(M.version || M.VERSION || '未知') : '未加载', ok: !!M, note: M ? (typeof M.parseMessage === 'function' ? '可解析补丁（写回需要它）' : '只读（没有 parseMessage）') : '变量写回 / 试解析不可用，其它功能照常' });
    depCache.rows = rows; depCache.at = Date.now();
    return rows;
}
let depRenderedAt = 0;
async function refreshDepBox(force) {
    const box = document.getElementById('cc-dep');
    if (!box) return;
    if (settings()?.depCheck === false) { box.innerHTML = '<div class="cc-muted">' + escHtml(T('depOff')) + '</div>'; return; }
    if (!force && (Date.now() - depRenderedAt) < 30000) return;
    depRenderedAt = Date.now();
    box.innerHTML = '<div class="cc-muted">' + escHtml(T('depLoading')) + '</div>';
    try {
        const rows = await depStatus(force);
        box.innerHTML = rows.map((r) => '<div class="cc-line ' + (r.ok ? '' : 'cc-warn') + '"><b>' + escHtml(r.name) + '</b>：' + escHtml(r.version) + ' <span class="cc-muted">' + escHtml(r.note) + '</span></div>').join('');
    } catch (e) { box.innerHTML = '<div class="cc-warn">' + escHtml(String(e && e.message || e)) + '</div>'; }
}
/** 面板里显示「本卡用的是哪种变量协议 + 能不能写回」；没有变量系统就把相关开关收起来 */
function renderProtocolLine() {
    const box = document.getElementById('cc-proto');
    if (!box) return;
    try {
        const pr = (profileOf().protocol) || { id: 'none', label: '（未识别）', canWriteBack: false };
        // 0.6.0：本卡自带的前端界面（动态状态栏 / 交互面板），让用户一眼看到「状态栏是这张卡自己渲染的」
        const vw = (profileOf().views) || { bars: [], panels: [] };
        let extra = '';
        if ((vw.bars || []).length) extra += ' ｜ ' + escHtml(T('scanDyn')) + ' ' + vw.bars.length + (vw.dynamic ? '✦' : '');
        if ((vw.panels || []).length) extra += ' ｜ ' + escHtml(T('scanPanel')) + ' ' + vw.panels.length;
        // 0.9.0：本卡被禁用的渲染正则（插图/状态栏/面板）—— 卡自带脚本会自动开启的只作说明，否则是警告
        const dv = (profileOf().disabledViews) || { total: 0, autoEnable: false };
        if (dv.total) extra += ' ｜ ' + escHtml(T('disViews')) + ' ' + dv.total + escHtml(dv.autoEnable ? T('disAuto') : ((dv.uncovered || 0) > 0 ? T('disWarn') : T('disAlt')));
        box.innerHTML = '<b>' + escHtml(T('protocol')) + '</b>：' + escHtml(pr.label) + ' ｜ ' + escHtml(pr.canWriteBack ? T('capWrite') : T('capReadonly')) + extra;
        const cfg = document.getElementById('cc-var-cfg');
        if (cfg) cfg.style.display = (pr.id === 'none') ? 'none' : '';
    } catch (_) {}
}
/* ── 0.5.0：兼容性体检（对全部角色卡跑一遍判定）────────────────── */
let scanResult = null;
let scanFilter = '';
function verdictLabel(v) { return T('v_' + v) || v; }
// 0.7.0：没抽到规则的原因标签
function rsLabel(k) { return T('rs_' + k) || k; }
// 0.9.0：新卡哨兵的预警标签
function alertLabel(k) { return T('alert_' + k) || k; }
function renderScan() {
    const sum = document.getElementById('cc-scan-sum');
    const rowsBox = document.getElementById('cc-scan-rows');
    const filt = document.getElementById('cc-scan-filter');
    if (!sum || !rowsBox) return;
    if (!scanResult) { sum.textContent = T('scanIdle'); rowsBox.innerHTML = ''; if (filt) filt.innerHTML = ''; return; }
    const s = scanResult.summary;
    const at = scanResult.at ? new Date(scanResult.at).toLocaleString() : '';
    sum.innerHTML = '<b>' + escHtml(T('scanSum')) + '</b>：' + s.total + escHtml(T('scanOf')) + ' ｜ ' + escHtml(T('scanGuard')) + ' ' + s.guardable +
        ' ｜ ' + escHtml(T('scanWrite')) + ' ' + s.writable + ' ｜ ' + escHtml(T('scanRules')) + ' ' + s.rules +
        // 0.6.0：卡自带的前端界面（动态状态栏 / 交互面板）也计入总览 —— 括号里是「引用了变量或带脚本」的真动态数
        ' ｜ ' + escHtml(T('scanDyn')) + ' ' + (s.dynBars || 0) + ((s.dynBarsDynamic || 0) ? ('（' + s.dynBarsDynamic + ' ' + escHtml(T('scanDynYes')) + '）') : '') +
        ' ｜ ' + escHtml(T('scanPanel')) + ' ' + (s.panels || 0) +
        // 0.7.0：no-rules 的卡到底为什么没规则（散文/命令式/结构/schema/没有）
        (Object.keys(s.noRulesStyles || {}).length ? (' ｜ ' + escHtml(T('scanNoRules')) + ' ' + Object.keys(s.noRulesStyles).map((k) => escHtml(rsLabel(k)) + '×' + s.noRulesStyles[k]).join(' ')) : '') +
        (Object.keys(s.alerts || {}).length ? (' ｜ ' + escHtml(T('scanAlerts')) + ' ' + Object.keys(s.alerts).map((k) => escHtml(alertLabel(k)) + '×' + s.alerts[k]).join(' ')) : '') +
        ' ｜ ' + Object.keys(s.protocol).map((k) => escHtml(k) + '×' + s.protocol[k]).join(' ') + (at ? ' ｜ ' + escHtml(at) + ' ｜ ' + scanResult.ms + 'ms' : '');
    if (filt) {
        const keys = ['', 'ok', 'guard-only', 'dyn-bar', 'no-rules', 'read-only', 'format-only', 'helper-only', 'plain'];
        filt.innerHTML = keys.map((v) => '<button class="btn-secondary btn-xs cc-chip" data-scan-filter="' + v + '" style="margin:2px;' + (scanFilter === v ? 'outline:1px solid currentColor;' : '') + '">' +
            escHtml(v ? (verdictLabel(v) + ' (' + (s.verdicts[v] || 0) + ')') : (T('v_all') + ' (' + s.total + ')')) + '</button>').join('');
    }
    const list = scanFilter ? scanResult.rows.filter((r) => r.verdict === scanFilter) : scanResult.rows;
    // 每行末尾标出「卡自带的前端界面」：✦ = 真动态（HTML 里引用了变量或有脚本）
    const marks = (r) => (r.bars ? (' ｜ ' + T('scanDyn') + (r.dynBar ? '✦' : '')) : '') + (r.panels ? (' ｜ ' + T('scanPanel')) : '') + (r.ruleStyle ? (' ｜ ' + rsLabel(r.ruleStyle)) : '') + (((r.alerts || []).indexOf('disabled-views') >= 0 || (r.alerts || []).indexOf('new-dialect') >= 0) ? ' ❗' : ((r.alerts || []).indexOf('disabled-alternative') >= 0 ? ' ◇' : ''));
    rowsBox.innerHTML = '<table class="cc-tab"><thead><tr><th>' + escHtml(T('colCard')) + '</th><th>' + escHtml(T('colProto')) + '</th><th>' + escHtml(T('colCap')) + '</th><th>' + escHtml(T('colVerdict')) + '</th></tr></thead><tbody>' +
        list.slice(0, 200).map((r) => '<tr><td>' + escHtml(String(r.name || '').slice(0, 22)) + '</td><td>' + escHtml(r.protocol || '-') + '</td><td>' + (r.anchors || 0) + '/' + (r.dataTags || 0) + '/' + (r.required || 0) + '</td><td>' + escHtml(verdictLabel(r.verdict) + marks(r)) + '</td></tr>').join('') +
        '</tbody></table>' + (list.length > 200 ? '<div class="cc-muted">' + escHtml(T('scanMore')) + '</div>' : '');
}
async function runCompatScan() {
    const sum = document.getElementById('cc-scan-sum');
    if (sum) sum.textContent = T('scanRunning');
    try {
        const ctx = getContext();
        const cards = (ctx && ctx.characters) || [];
        const t0 = Date.now();
        const r = scanCardCompatibility(cards);
        scanResult = { at: Date.now(), summary: r.summary, rows: r.rows, ms: Date.now() - t0 };
        try { const s = settings(); s.compatScan = { at: scanResult.at, summary: r.summary }; saveSettingsDebounced(); } catch (_) {}
        log('compat-scan', r.summary.total + ' 张 / ' + scanResult.ms + 'ms', JSON.stringify(r.summary.verdicts));
        renderScan();
    } catch (e) { if (sum) sum.textContent = escHtml(String((e && e.message) || e)); }
}
async function copyScanReport() {
    if (!scanResult) { toast(T('scanIdle'), 'info'); return; }
    const s = scanResult.summary;
    const lines = [T('scanSum') + ': ' + s.total + ' 张', '结论: ' + JSON.stringify(s.verdicts), '协议: ' + JSON.stringify(s.protocol),
        '可守护 ' + s.guardable + ' / 可写回 ' + s.writable + ' / 有规则 ' + s.rules + ' / 动态状态栏 ' + (s.dynBars || 0) + '（真动态 ' + (s.dynBarsDynamic || 0) + '） / 交互面板 ' + (s.panels || 0),
        T('scanNoRules') + ': ' + JSON.stringify(s.noRulesStyles || {}) + ' | ' + T('scanAlerts') + ': ' + JSON.stringify(s.alerts || {}),
        '', T('colCard') + ' | ' + T('colProto') + ' | ' + T('colVerdict')];
    for (const r of scanResult.rows) lines.push(r.name + ' | ' + (r.protocol || '-') + ' | ' + r.verdict + ' | 锚点' + r.anchors + ' 数据块' + r.dataTags + ' 规则' + r.required + (r.bars ? (' | 状态栏' + r.bars) : '') + (r.panels ? (' | 面板' + r.panels) : '') + (r.ruleStyle ? (' | 无规则原因:' + r.ruleStyle) : '') + (r.disabledViews ? (' | 禁用渲染正则:' + r.disabledViews + (r.autoEnable ? '(卡自带脚本开启)' : ((r.disabledUncovered || 0) > 0 ? '(其中' + r.disabledUncovered + '条不会显示)' : '(属备选)'))) : '') + ((r.alerts || []).length ? (' | 预警:' + r.alerts.join('+')) : ''));
    try { await navigator.clipboard.writeText(lines.join(String.fromCharCode(10))); toast(T('scanCopied'), 'success'); } catch (_) { toast(T('scanCopyFail'), 'warning'); }
}
/**
 * 0.16.0：把面板里散落的事实收成一段「可复制的本卡诊断」。
 * 只读现有状态（profile / 覆盖度 / 最近动作 / 结构约束），不触发任何写操作。
 */
/** 与体检同口径的单卡结论（体检是对全部卡跑同一套判定） */
function localVerdict(prof) {
    try {
        const hasAnchor = (prof.anchors || []).length > 0;
        const hasData = (prof.dataTags || []).length > 0;
        const proto = prof.protocol || {};
        const hasBar = !!(prof.views && (prof.views.bars || []).length);
        if (!hasAnchor && !hasData) {
            if (hasBar) return 'dyn-bar';
            return (prof.rawTags || []).length ? 'format-only' : ((prof.helperCount || 0) > 0 ? 'helper-only' : 'plain');
        }
        if (!hasData) return 'guard-only';
        if (!(prof.required || []).length) return 'no-rules';
        if (!proto.canWriteBack && proto.id !== 'none') return 'read-only';
        return 'ok';
    } catch (_) { return 'ok'; }
}
async function copyDiagnosisReport() {
    try {
        const profile = profileOf();
        const id = (chat && chat.length) ? chat.length - 1 : -1;
        const m = (chat && chat[id]) || null;
        const blocks = (m && typeof m.mes === 'string') ? extractUpdateBlocks(m.mes) : [];
        const patchTextOf = (b) => (b && (b.patchText || b.block)) || '';
        const ops = blocks.reduce((n, b) => n + ((parsePatchOps(patchTextOf(b)).ops || []).length), 0);
        const cov = (lastReport && lastReport.id === id) ? lastReport.covered : (m ? coverageByProtocol(m.mes, profile.required || [], profile.protocol).covered : null);
        const req = profile.required || [];
        let cardName = '';
        try { const ctx = getContext(); const ch = ctx && ctx.characters && ctx.characters[ctx.characterId]; cardName = (ch && ch.name) || ''; } catch (_) {}
        const hs = schemaHintsOfCard();
        const st = (lastReport && lastReport.state) || null;
        const text = diagnosisReportText({
            version: VERSION,
            at: Date.now(),
            card: cardName,
            floor: id,
            host: (() => { try { const c = getContext(); return String((c && c.version) || 'ST'); } catch (_) { return 'ST'; } })(),
            lang: langOf(),
            verdict: localVerdict(profile),
            ruleStyle: (profile.required || []).length ? '' : '见兼容性体检',
            profile: profile,
            protocol: { id: profile.protocol, canWriteBack: !!profile.canWriteBack },
            required: req.length,
            allowed: (profile.allowed && Object.keys(profile.allowed).length) || 0,
            book: (profile.bookCount || 0),
            scope: (() => { try { return varScope(); } catch (_) { return { scope: 'message', reason: '' }; } })(),
            schemaHints: hs,
            disabledViews: (profile.disabledViews && profile.disabledViews.total) || 0,
            disabledUncovered: (profile.disabledViews && profile.disabledViews.uncovered) || 0,
            thisFloor: m ? { verdict: T('apply_' + patchApplyVerdict({ hasBlock: blocks.length > 0, hasPatch: /<JSONPatch\b/i.test(m.mes), ops: ops, hasStates: false, sameState: false }).level), blocks: blocks.length, covered: (cov || []).length, total: req.length } : null,
            state: st,
            money: (lastReport && lastReport.money) || null,
            guards: stats.guarded || 0,
            removed: stats.stripped || 0,
            yamlFixes: (stats.yamlQuoted || 0) + (stats.yamlStructureFixed || 0),
            floors: { written: stats.varReplayFloors || 0, skipped: stats.varStuck || 0, guard: stats.varGuard || 0, schema: stats.varSchema || 0 },
            schemaFails: stats.varSchema || 0,
            recent: (recent || []).slice(0, 8).map((r) => r.t + ' ' + r.type + (r.tag ? (' [' + r.tag + ']') : '') + (r.extra ? (' ' + r.extra) : '')),
        });
        await navigator.clipboard.writeText(text);
        toast(T('diagCopied'), 'success');
        log('diag-copy', '本卡', '诊断文本已复制（' + text.split(String.fromCharCode(10)).length + ' 行）');
    } catch (e) {
        toast(T('diagFail'), 'warning');
        log('diag-fail', '', String((e && e.message) || e));
    }
}
function renderMvuBox() {
    const box = document.getElementById('cc-mvu');
    if (!box) return;
    const info = mvuInfo();
    if (!info.api) { box.innerHTML = '<div class="cc-line cc-warn">' + escHtml(T('mvuNone')) + '</div>'; return; }
    const extra = mvuExtraParseEnabled();
    const lines = ['<div class="cc-line"><b>' + escHtml(T('mvuApi')) + '</b>' + (info.version ? ('：v' + escHtml(info.version)) : '') + '（parse=' + (info.parse ? '✅' : '❌') + ' read=' + (info.read ? '✅' : '❌') + ' write=' + (info.write ? '✅' : '❌') + '）</div>'];
    lines.push('<div class="cc-line ' + (extra === true ? 'cc-warn' : 'cc-muted') + '">' + escHtml(extra === true ? T('mvuExtraOn') : T('mvuExtraOff')) + '</div>');
    box.innerHTML = lines.join('');
}
/** 扩展信息卡默认折叠，只留一行「ⓘ 扩展信息」 */
function applyInfoOpen() {
    try {
        const body = document.getElementById('cc-info-body');
        const tg = document.getElementById('cc-info-toggle');
        if (!body) return;
        const open = settings()?.infoOpen === true;
        body.style.display = open ? '' : 'none';
        if (tg) { tg.setAttribute('aria-expanded', open ? 'true' : 'false'); tg.textContent = (open ? '▾ ' : 'ⓘ ') + T('infoTitle'); }
    } catch (_) {}
}
function buildSettingsUi() {
    const host = document.getElementById('extensions_settings');
    if (!host || document.getElementById('cc-panel')) return;
    const wrap = document.createElement('div');
    wrap.className = 'extension_container';
    wrap.id = 'cc-panel';
    const cb = (id, key) => '<label class="checkbox_label"><input type="checkbox" id="' + id + '"><span>' + escHtml(T(key)) + '</span></label>';
    wrap.innerHTML = [
        '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🧩 ' + escHtml(T('title')) + ' v' + VERSION + '</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>',
        '<div class="inline-drawer-content">',
        // 0.22.0：把「插件总开关」提到面板最上面（原先埋在 ① 组里，用户找不到），并显示运行状态
        '<label class="checkbox_label cc-master"><input type="checkbox" id="cc-enabled"><span><b>' + escHtml(T('switchTitle')) + '</b> <i id="cc-master-state"></i></span></label>',
        '<div id="cc-stats" class="cc-stats"></div>',
        '<div id="cc-trend" class="cc-trend"></div>',
        '<details class="cc-grp" open><summary>① ' + escHtml(T('secGuard')) + '</summary>',
        cb('cc-inject-prompt', 'injectPrompt'), cb('cc-inject', 'injectAnchor'), cb('cc-repair', 'repair'), cb('cc-stale', 'stale'),
        cb('cc-var-auto', 'varAuto'), cb('cc-var-repair', 'varRepair'), cb('cc-overdraft', 'overdraftGuard'), cb('cc-schema-guard', 'schemaGuard'), cb('cc-var-barcb', 'varBar'), cb('cc-money-check', 'moneyCheck'), cb('cc-money-fix', 'moneyFix'), cb('cc-table-write', 'tableWrite'),
        "<button id=\"cc-check\" class=\"menu_button\">" + escHtml(T('btnCheck')) + "</button>",
        "<button id=\"cc-refresh\" class=\"menu_button\">" + escHtml(T('btnRefresh')) + "</button>",
        "<button id=\"cc-check-front\" class=\"menu_button\">" + escHtml(T('btnCheckFront')) + "</button>",
        '<div id="cc-front" class="cc-line cc-muted"></div>',
        '<div id="cc-apply" class="cc-line cc-muted"></div>',
        '<div id="cc-fails" class="cc-line cc-muted"></div>',
        '</details>',
        '<details class="cc-grp"><summary>② ' + escHtml(T('secBlocks')) + '</summary>',
        cb('cc-fix-quotes', 'fixQuotes'), cb('cc-bracket-tags', 'fixBracketTags'), cb('cc-quote-scalars', 'quoteScalars'), cb('cc-yaml-structure', 'fixYamlStructure'), cb('cc-yaml-strict', 'yamlStrict'), cb('cc-strip-undeclared', 'stripUndeclared'),
        cb('cc-autofix-vars', 'autoFixVars'), cb('cc-path-warn', 'pathWarn'), cb('cc-toast-fail', 'toastOnFail'),
        "<button id=\"cc-varfix-now\" class=\"menu_button\">" + escHtml(T('btnVarfix')) + "</button>",
        "<button id=\"cc-yaml-check\" class=\"menu_button\">" + escHtml(T('btnYaml')) + "</button>",
        '</details>',
        '<details class="cc-grp" open><summary>③ ' + escHtml(T('secReport')) + '</summary><div id="cc-table" class="cc-table"></div></details>',
        '<details class="cc-grp"><summary>④ ' + escHtml(T('secDep')) + '</summary>',
        '<div id="cc-dep" class="cc-mvu"></div>',
        '<div id="cc-schema" class="cc-line cc-muted"></div>',
        '<div id="cc-proto" class="cc-line"></div>',
        cb('cc-compat-mode', 'compatMode'),
        '<div class="cc-line cc-muted">' + escHtml(T('compatNote')) + '</div>',
        '<div id="cc-var-cfg">',
        cb('cc-mvu-verify', 'mvuVerify'),
        "<button id=\"cc-mvu-write\" class=\"menu_button\">" + escHtml(T('btnMvu')) + "</button>",
        "<button id=\"cc-mvu-test\" class=\"menu_button\">" + escHtml(T('btnMvuTest')) + "</button>",
        '</div>',
        '</details>',
        '<details class="cc-grp"><summary>⑤ ' + escHtml(T('secUi')) + '</summary>',
        cb('cc-nudge-render', 'nudgeRender'), cb('cc-rerender-old', 'rerenderOld'),
        '<label>' + escHtml(T('panelFont')) + '</label><select id="cc-font"><option value="1">' + escHtml(T('fontFollow')) + '</option><option value="1.15">' + escHtml(T('fontBig')) + '</option><option value="1.3">' + escHtml(T('fontBigger')) + '</option></select>',
        '<label>' + escHtml(T('lang')) + '</label><select id="cc-lang"><option value="auto">' + escHtml(T('langAuto')) + '</option><option value="zh">中文</option><option value="en">English</option></select>',
        '<label>' + escHtml(T('zoom')) + ' <span id="cc-zoom-val"></span></label><input type="range" id="cc-zoom" min="0.9" max="1.6" step="0.05">',
        '<label>' + escHtml(T('floor')) + ' <span id="cc-floor-val"></span></label><input type="range" id="cc-floor" min="0" max="16" step="1">',
        '<div id="cc-font-warn" class="cc-line cc-warn" style="display:none"></div>',
        '<details><summary>' + escHtml(T('log')) + '</summary><pre id="cc-log" class="cc-log"></pre></details>',
        '</details>',
'<details class="cc-grp"><summary>⑥ ' + escHtml(T('secScan')) + '</summary>',
        '<div class="cc-line cc-muted">' + escHtml(T('scanNote')) + '</div>',
        '<div class="cc-info-actions"><button id="cc-scan-run" class="menu_button">' + escHtml(T('scanRun')) + '</button><button id="cc-scan-copy" class="menu_button">' + escHtml(T('scanCopy')) + '</button><button id="cc-diag-copy" class="menu_button" title="' + escHtml(T('diagTip')) + '">' + escHtml(T('diagCopy')) + '</button></div>',
        '<div id="cc-scan-sum" class="cc-line"></div>',
        '<div id="cc-scan-filter" class="cc-line"></div>',
        '<div id="cc-scan-rows" class="cc-scan-rows"></div>',
        '</details>',
        '<div id="cc-info" class="cc-info">',
        '<div id="cc-info-toggle" class="cc-info-toggle" role="button" tabindex="0">ⓘ ' + escHtml(T('infoTitle')) + '</div>',
        '<div id="cc-info-body" class="cc-info-body" style="display:none">',
        '<div class="cc-info-name">🧩 <b>' + escHtml(T('title')) + '</b> (Card Compat) · Ver ' + VERSION + '</div>',
        '<div class="cc-info-actions"><button id="cc-info-log" class="menu_button">' + escHtml(T('viewLog')) + '</button></div>',
        '<div class="cc-info-line">' + escHtml(T('infoAuthor')) + '<a href="' + REPO + '" target="_blank" rel="noopener">' + REPO + '</a></div>',
        '<div class="cc-info-note">' + escHtml(T('infoNote')) + '</div>',
        '</div>',
        '</div>',
        '</div></div>',
    ].join('');
    host.appendChild(wrap);
    const bind = (id, key, isCheck) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (isCheck) el.checked = !!settings()[key]; else el.value = settings()[key];
        el.addEventListener('input', () => {
            settings()[key] = isCheck ? el.checked : Number(el.value);
            saveSettingsDebounced(); applyFont(); renderStats();
            const zv = document.getElementById('cc-zoom-val'); if (zv) zv.textContent = Math.round(settings().fontZoom * 100) + '%';
            const fv = document.getElementById('cc-floor-val'); if (fv) fv.textContent = settings().fontFloor ? settings().fontFloor + 'px' : T('floorOff');
        });
    };
    bind('cc-enabled', 'enabled', true);
    bind('cc-inject', 'injectAnchor', true);
    bind('cc-repair', 'repairClosure', true);
    bind('cc-stale', 'notifyStale', true);
    bind('cc-inject-prompt', 'injectPrompt', true);
    bind('cc-var-auto', 'varAuto', true);
    bind('cc-var-repair', 'varRepair', true);
    bind('cc-overdraft', 'overdraftGuard', true);
    bind('cc-schema-guard', 'schemaGuard', true);
    bind('cc-var-barcb', 'varBar', true);
    bind('cc-money-check', 'moneyCheck', true);
    bind('cc-money-fix', 'moneyFix', true);
    bind('cc-table-write', 'tableWrite', true);
    bind('cc-fix-quotes', 'fixSmartQuotes', true);
    bind('cc-bracket-tags', 'fixBracketTags', true);
    bind('cc-quote-scalars', 'quoteScalars', true);
    bind('cc-yaml-structure', 'fixYamlStructure', true);
    bind('cc-yaml-strict', 'yamlStrict', true);
    bind('cc-strip-undeclared', 'stripUndeclared', true);
    bind('cc-autofix-vars', 'autoFixVars', true);
    bind('cc-path-warn', 'pathWarn', true);
    bind('cc-toast-fail', 'toastOnFail', true);
    bind('cc-mvu-verify', 'mvuVerify', true);
    bind('cc-compat-mode', 'compatMode', true);
    bind('cc-nudge-render', 'nudgeRender', true);
    bind('cc-rerender-old', 'rerenderOldFloors', true);
    document.getElementById('cc-varfix-now')?.addEventListener('click', async () => { varFixTriedIds.delete(chat.length - 1); await maybeFixVars(chat.length - 1); });
    document.getElementById('cc-yaml-check')?.addEventListener('click', async () => { await strictCheckMessage(chat.length - 1, { force: true }); });
    document.getElementById('cc-mvu-write')?.addEventListener('click', async () => { await writeBackMvu(chat.length - 1, false); });
    document.getElementById('cc-mvu-test')?.addEventListener('click', async () => {
        const info = mvuInfo();
        if (!info.api) { toast(T('mvuNone'), 'warning'); return; }
        const ex = extractUpdateBlock(chat?.[chat.length - 1]?.mes || '');
        if (!ex) { toast(langOf() === 'en' ? 'No variable block in current reply' : '当前楼层没有变量块', 'info'); return; }
        const r = await mvuCanParse(ex.block, chat.length - 1);
        if (!r.checked) toast(T('mvuNone'), 'warning');
        else if (r.ok) toast(T('mvuParsed'), 'success');
        else toast(T('mvuUnparsed') + r.reason, 'warning');
        renderMvuBox();
    });
    document.getElementById('cc-scan-run')?.addEventListener('click', () => { runCompatScan(); });
    document.getElementById('cc-scan-copy')?.addEventListener('click', () => { copyScanReport(); });
    document.getElementById('cc-diag-copy')?.addEventListener('click', () => { copyDiagnosisReport(); });
    // 0.21.0：资金纠正按钮（事件委托，面板重绘后依然有效）
    document.getElementById('cc-table')?.addEventListener('click', (e) => {
        const el = e.target && e.target.closest ? e.target.closest('.cc-money-fix, .cc-money-undo, .cc-table-write') : null;
        if (!el) return;
        if (el.classList.contains('cc-money-undo')) { undoMoneyFix(); return; }
        if (el.classList.contains('cc-table-write')) { applyTableWrite(Number(el.getAttribute('data-floor'))); return; }
        const path = el.getAttribute('data-path') || '';
        const delta = Number(el.getAttribute('data-delta'));
        const floor = Number(el.getAttribute('data-floor'));
        if (!path || !Number.isFinite(delta) || !Number.isFinite(floor)) return;
        callGenericPopup('<b>' + escHtml(T('moneyFixConfirm')) + '</b><br>' + escHtml(path + '  ' + (delta > 0 ? '+' : '') + delta), POPUP_TYPE.CONFIRM).then((ok) => { if (ok) applyMoneyFix(floor, path, delta); });
    });
    document.getElementById('cc-scan-filter')?.addEventListener('click', (e) => { const b = e.target && e.target.closest ? e.target.closest('[data-scan-filter]') : null; if (!b) return; scanFilter = b.getAttribute('data-scan-filter') || ''; renderScan(); });
    document.getElementById('cc-info-toggle')?.addEventListener('click', () => { const st2 = settings(); st2.infoOpen = !(st2.infoOpen === true); saveSettingsDebounced(); applyInfoOpen(); });
    document.getElementById('cc-info-log')?.addEventListener('click', () => { showChangelog(); });
    applyInfoOpen();
    document.getElementById('cc-refresh')?.addEventListener('click', () => { invalidateProfile(); updatePromptInjection(); toast(T('refreshOK'), 'success'); renderStats(); });
    const fontSel = document.getElementById('cc-font');
    if (fontSel) { fontSel.value = String(settings().panelFont || 1); fontSel.addEventListener('change', () => { settings().panelFont = Number(fontSel.value) || 1; saveSettingsDebounced(); applyPanelFont(); }); }
    const langSel = document.getElementById('cc-lang');
    if (langSel) {
        langSel.value = String(settings().lang || 'auto');
        langSel.addEventListener('change', () => { settings().lang = langSel.value || 'auto'; saveSettingsDebounced(); const w = document.getElementById('cc-panel'); if (w) { w.remove(); buildSettingsUi(); applyPanelFont(); } });
    }
    bind('cc-zoom', 'fontZoom', false);
    bind('cc-floor', 'fontFloor', false);
    const zv = document.getElementById('cc-zoom-val'); if (zv) zv.textContent = Math.round(settings().fontZoom * 100) + '%';
    const fv = document.getElementById('cc-floor-val'); if (fv) fv.textContent = settings().fontFloor ? settings().fontFloor + 'px' : T('floorOff');
    document.getElementById('cc-check')?.addEventListener('click', () => { guardMessage(chat.length - 1); verifyRendered(chat.length - 1); checkFrontBlocks(chat.length - 1); checkPatchApplied(chat.length - 1); });
    document.getElementById('cc-check-front')?.addEventListener('click', () => { const id = chat.length - 1; frontAlerted.delete(id); checkFrontBlocks(id); });
    applyPanelFont();
    renderStats();
}
/** P3 ⑨ 对外钩子：其它扩展（MVU / 酒馆助手脚本）可以直接调用 */
/* ── 扩展信息 / 查看日志（0.3.1）── */
let changelogCache = null;
/** 读扩展目录里的 CHANGELOG.md（跟着扩展一起部署，离线也有） */
async function loadChangelog() {
    if (changelogCache) return changelogCache;
    try {
        const url = new URL('./CHANGELOG.md', import.meta.url).href;
        const res = await fetch(url, { cache: 'no-cache' });
        changelogCache = (res && res.ok) ? await res.text() : '';
    } catch (_) { changelogCache = ''; }
    return changelogCache;
}
/** 打开「更新日志」弹窗（ST 原生 popup） */
async function showChangelog() {
    try {
        const md = await loadChangelog();
        const head = '<div class="cc-log-head"><b>🧩 ' + escHtml(T('title')) + '</b> v' + VERSION + ' ｜ <a href="' + REPO + '/blob/main/extensions/card-compat/CHANGELOG.md" target="_blank" rel="noopener">GitHub</a></div>';
        const body = md ? renderChangelogMarkdown(md) : ('<p>' + escHtml(T('logMissing')) + '</p>');
        await callGenericPopup('<div class="cc-log-doc">' + head + body + '</div>', POPUP_TYPE.TEXT, '', { okButton: T('close'), wide: true, large: true, allowVerticalScrolling: true });
    } catch (e) { toast(T('logOpenFail') + String((e && e.message) || e), 'warning'); }
}
function exposeApi() {
    try {
        if (typeof window === 'undefined') return;
        window.CardCompat = {
            version: VERSION,
            profile: () => profileOf(),
            guard: (id) => guardMessage(id),
            coverage: (id) => patchCoverage((chat && chat[id] && chat[id].mes) || '', (profileOf().required) || []),
            validatePaths: (block) => validatePatchPaths(block, profileOf().allowed || {}),
            applyToMvu: (block, id) => applyPatchToMvu(block, id),
            writeBack: (id) => writeBackMvu(id, true),
            mvu: () => mvuInfo(),
            protocol: () => profileOf().protocol,
            compatMode: () => settings()?.compatMode === true,
            deps: (f) => depStatus(!!f),
            scan: (cards) => scanCardCompatibility(cards || (getContext()?.characters || [])),
            invalidate: () => invalidateProfile(),
            changelog: () => showChangelog(),
            recompute: (o) => recomputeAllFloors(o || {}),
            varScope: () => varScope(),
            varHints: () => schemaHintsOfCard(),
            initVar: () => initVarOfCard(),
            stateOf: (id, scope) => readStateOf(id, scope),
            opsOf: (id) => { const m = chat && chat[id]; return (m && typeof m.mes === 'string') ? opsForMessage(m.mes) : []; },
            stats: () => Object.assign({}, stats),
            trend: () => covHistory.slice(),
        };
    } catch (_) {}
}
(async function init() {
    extension_settings[NAME] = Object.assign({}, DEFAULTS, extension_settings[NAME] || {});
    // 心跳：让外部（套壳/排查）能确认扩展是否真的加载与运行
    try {
        settings().loadedAt = new Date().toISOString();
        settings().loadedVersion = VERSION;
        settings().runCount = settings().runCount || 0;
        saveSettingsDebounced();
    } catch (_) {}
    buildSettingsUi();
    applyFont();
    exposeApi();
    // ① 非流式：渲染前
    eventSource.on(event_types.MESSAGE_RECEIVED, (id) => { try { watchCard(); } catch (_) {} try { guardMessage(id, { rerender: false }); } catch (e) { console.error(e); } });
    // ② 流式：生成结束（hideStopButton 触发），此时 messageId = chat.length-1
    eventSource.on(event_types.GENERATION_ENDED, () => { try { const id = chat.length - 1; if (lastSeen.get(id) !== chat[id]?.mes) guardMessage(id); } catch (e) { console.error(e); } try { const id = chat.length - 1; setTimeout(() => { try { checkPatchApplied(id, { notify: false }); } catch (_) {} }, 2500); setTimeout(() => { try { checkPatchApplied(id); } catch (_) {} }, 7000); } catch (_) {}
    // 0.10.0：MVU 不在（或被关）时自动兜底 —— 自己把本轮补丁应用进变量，状态栏才会动
    try { if (settings().varAuto !== false && !mvuActive() && !settings().compatMode) { setTimeout(() => { try { recomputeAllFloors({ silent: true, toast: false, auto: true }); } catch (_) {} }, 1800); } } catch (_) {} });
    // ③ 渲染后兜底校验
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id) => { try { watchCard(); } catch (_) {} try { verifyRendered(id); } catch (_) {} try { setTimeout(() => { try { checkFrontBlocks(id); } catch (_) {} }, 1500); } catch (_) {} });
    // 0.10.0：变量兜底按钮条（照剧情推进插件：注入 #send_form + 事件/MutationObserver 重注入）
    try { for (const ev of [event_types.GENERATION_STARTED, event_types.GENERATION_ENDED, event_types.GENERATION_STOPPED, event_types.MESSAGE_SENT, event_types.CHAT_CHANGED]) eventSource.on(ev, () => { try { applyVarBar(); } catch (_) {} }); } catch (_) {}
    try {
        const form = document.getElementById('send_form');
        const target = form ? form.parentElement : document.body;
        if (target) {
            new MutationObserver(() => {
                if (varBarTimer) return;
                varBarTimer = setTimeout(() => { varBarTimer = null; if (!document.getElementById('cc-var-bar')) { try { applyVarBar(); } catch (_) {} } }, 400);
            }).observe(target, { childList: true, subtree: false });
        }
    } catch (_) {}
    try { applyVarBar(); } catch (_) {}
    try { watchCard(); } catch (_) {}
    try { setInterval(watchCard, 3000); } catch (_) {}
    eventSource.on(event_types.CHAT_CHANGED, () => {
      try {
        invalidateProfile(); applyFont(); lastSeen.clear(); varRepairTried.clear(); updatePromptInjection(); applyVarBar();
        hardFailStreak = 0; strictChecked.clear(); varFixTriedIds.clear(); frontAlerted.clear(); applyAlerted.clear(); failTrace.length = 0; for (const k of Object.keys(failStreak)) failStreak[k] = 0; failAlerted.clear(); strippedByFloor.clear();  // C14/C23：换聊天清空这些「每楼一条」的集合，避免跨聊天累积与误弹
        cardKey = cardKeyNow();                 // 同步卡标识：同卡换聊天不该走「切卡」分支
        refreshReport(0);                       // 0.13.2：上一张卡的表立刻消失，按当前卡重建
        setTimeout(normalizeRecent, 600);
      } catch (_) {}
      // 0.11.0 / 0.13.2：切聊天/切卡后自动核对一次（面板第三列自己填上；确认没生效就自动修）
      try { setTimeout(() => { try { refreshReport(0); checkPatchApplied(chat.length - 1, { notify: false }); } catch (_) {} }, 2200); } catch (_) {} });
    eventSource.on(event_types.MESSAGE_SENT, () => { try { updatePromptInjection(); } catch (_) {} });
    try { updatePromptInjection(); } catch (_) {}
    setTimeout(normalizeRecent, 900);
    try { const info = mvuInfo(); console.log('[card-compat] 已加载 v' + VERSION + '（守护 + 结尾提醒注入 + 历史规范化 + MVU 联动）MVU API=' + (info.api ? '有' : '无')); } catch (_) { console.log('[card-compat] 已加载 v' + VERSION); }
})();
