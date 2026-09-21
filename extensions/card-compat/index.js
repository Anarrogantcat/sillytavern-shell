// 作者：小肥鱼（DeepSeek V4 Flash）· 染喵 ｜ 许可：AGPL-3.0 ｜ 项目：https://github.com/Anarrogantcat/sillytavern-shell
// index.js — 卡兼容助手（ST 扩展）v0.2.8
// ① 锚点守护 ② 数据块守护（绝不改数据内容）③ 消息区字号 ④ 结构块 YAML 修复/严格校验
// ⑤ 未声明块清理 ⑥ 变量块兜底（静默补一次 + 写回 MVU）⑦ 路径白名单 / 多块记账 / 覆盖度趋势 ⑧ MVU 联动
// 历史：v0.2.7 的「未声明块清理」被误插进 strictCheckMessage（那里没有 res，一进入就抛错并被吞掉）
//       → 本版把它放回 guardMessage 的入口，并补上 P1/P2/P3 全部路线图条目。
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, chat, saveChatDebounced, updateMessageBlock, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, generateQuietPrompt } from '../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../scripts/popup.js';
import { buildProfile, guardText, isStale, normalizeMalformedClosings, detectForeignTags, buildTailReminder, dedupeSelfClosingAnchors, extractVarSpec, extractRequiredFields, patchCoverage, repairSmartQuotes, guardBlockYaml, strictYamlCheck, stripUndeclaredBlocks, KEEP_BLOCKS, extractUpdateBlock, extractUpdateBlocks, validatePatchBlock, buildVarFixPrompt, extractAllowedPaths, validatePatchPaths, blockPresence, parsePatchOps, normalizePath, repairYamlStructure, renderChangelogMarkdown, detectVariableProtocol, coverageByProtocol, scanCardCompatibility, anchoredViewConsuming } from './logic.js';

const NAME = 'card-compat';
const REPO = 'https://github.com/Anarrogantcat/sillytavern-shell';
const VERSION = '0.9.0';
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
    panelFont: 1,        // 面板字号倍率（1 / 1.15 / 1.3）
    dedupeAnchor: true,  // 续写追加出重复的自闭合锚点时自动合并
    scanRecent: 5,       // 启动/切聊天时自动规范化最近 N 楼（0=关闭）
    fixSmartQuotes: true, // 结构块内「英文引号开头 + 中文引号结尾」自动修（实测会让 YAML 解析失败）
    quoteScalars: true,   // 结构块内未加引号、但含「: 」或「 #」的值自动加英文引号（YAML 会截断/当嵌套键）
    fixYamlStructure: true, // 结构级修复：列表项行内映射+更深兄弟键、引号后跟「, 文字」（实测会让整块解析失败）
    yamlStrict: true,      // 结构块严格 YAML 校验（用扩展自带的 assets/js-yaml.min.js，失败会报警）
    stripUndeclared: true, // 清理「本卡没声明也没人渲染」的结构块（实测：模型把世界书原文回显成 <world_setting>）
    fixBracketTags: true,  // 0.8.0：模型把尖括号写成全角方括号时改回 <Tag>（实测【NSFW_IMG> 会让插图整块不显示）
    autoFixVars: false,     // 模型漏输出变量块时自动补一次（静默生成，只补补丁；默认关，避免意外调用 API）
    autoFixVarsMaxChars: 6000,
    pathWarn: true,        // 补丁路径白名单校验（只提示，不改写）
    mvuVerify: true,       // 用 MVU 的 parseMessage 试解析本轮变量块（能提前发现「块在但解析不了」）
    toastOnFail: true,     // 连续多楼缺变量块 → 弹一次气泡
    profileTtlMs: 60000,   // 角色卡档案缓存时长（P1 ④）
    lang: 'auto',          // 面板语言 auto|zh|en（P3 ⑩）
    nudgeRender: true,     // 重渲染后补发 MESSAGE_UPDATED，让酒馆助手立刻重画前端块（见 nudgeRender()）
    rerenderOldFloors: false, // 历史楼层修正后是否也重渲染（默认否：不拆掉已经画好的状态栏面板）
    compatMode: false,     // 0.4.0 兼容模式：关掉所有跨扩展联动（补发事件 / MVU 写回 / 自动补变量），只留纯文本守护
    depCheck: true,        // 0.4.0 面板显示 ST / 酒馆助手 / MVU 的版本与可用性
};
const stats = { guarded: 0, rerendered: 0, anchorInjected: 0, closeRepaired: 0, dataMissing: 0, staleWarned: 0, unrendered: 0, foreignTags: 0, duplicatesCollapsed: 0, quotesFixed: 0, scalarsQuoted: 0, yamlIssues: 0, yamlStructFixed: 0, yamlStrictOk: 0, yamlStrictFail: 0, yamlStrictSkipped: 0, blocksStripped: 0, unclosedBlocks: 0, varFixTried: 0, varFixOk: 0, varFixApplied: 0, varFixFailed: 0, coverageTotal: 0, coverageHit: 0, pathUnknown: 0, extraPaths: 0, multiBlocks: 0, nudgeMisses: 0, formatMissing: 0, bracketFixed: 0, mvuParseOk: 0, mvuParseFail: 0, toasts: 0 };
let lastCoverage = null;
let lastReport = null;            // P1 ② 面板对照表数据
const recent = [];
const covHistory = [];            // P2 ⑥ 覆盖度历史（最多 40 条）
const lastSeen = new Map();  // messageId -> 上次守护后的文本（续写会改写同一条消息，文本变了就要再守护一次）
let hardFailStreak = 0;           // P1 ③ 连续缺变量块的楼层数
let lastToastAt = 0;
let mvuExtraLogged = false;

/* ── P3 ⑩ 面板双语（zh/en），auto 跟随浏览器语言 ── */
const STRINGS = {
    zh: {
        title: '卡兼容助手', secGuard: '守护与修复', secBlocks: '结构块与变量块', secReport: '本卡要求 vs 本轮实际',
        secMvu: 'MVU 联动', secDep: '依赖与联动', secUi: '界面与诊断', enabled: '启用守护',
        secScan: '兼容性体检', scanNote: '对全部角色卡跑一遍判定：每张卡能做什么、为什么降级（本地纯计算，100 张约 0.2 秒）', scanRun: '开始体检', scanCopy: '复制报告', scanIdle: '还没体检过 —— 点「开始体检」', scanRunning: '体检中…', scanSum: '结果', scanOf: ' 张', scanGuard: '可守护', scanWrite: '可写回', scanRules: '有规则', colCard: '角色卡', colProto: '变量协议', colCap: '锚点/数据块/规则', colVerdict: '结论', scanMore: '（只显示前 200 张，完整结果可用「复制报告」）', scanCopied: '报告已复制', scanCopyFail: '复制失败（剪贴板不可用）', v_all: '全部', v_ok: '守护+校验可用', 'v_guard-only': '只能守护（无变量块）', 'v_no-rules': '有变量块但抽不到规则', 'v_read-only': '协议只读（不能写回）', 'v_format-only': '只有格式标签（仅提醒）', 'v_helper-only': '靠酒馆助手脚本渲染', v_plain: '纯正文卡（无需处理）', 'v_dyn-bar': '动态状态栏（前端渲染）', scanDyn: '动态状态栏', scanPanel: '交互面板', scanDynYes: '动态', scanNoRules: '无规则原因', scanAlerts: '预警', 'alert_new-dialect': '疑似新方言', 'alert_disabled-views': '渲染正则关着', disViews: '被禁用的渲染正则', disAuto: '（卡自带脚本会运行时开启）', disWarn: '（不会显示）', 'rs_check-unparsed': '有 check 但没解析出', rs_command: '命令式规则', rs_paths: '只有 paths 白名单', rs_structure: '只有变量结构', rs_schema: '规则在 schema 脚本', rs_prose: '散文式规则', rs_other: '其它写法', rs_none: '世界书里没有规则', 'v_error': '解析异常',
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
        fontFollow: '跟随 ST（默认）', fontBig: '大', fontBigger: '更大', zoom: '消息区缩放', floor: '字号下限',
        lang: '面板语言', langAuto: '自动', stats: '统计', log: '最近动作',
        noReport: '本轮还没有记录（发一条消息后这里会显示对照表）', colField: '卡要求的字段', colDone: '本轮是否更新',
        wrotePaths: '模型实际写入', unknownPaths: '不在本卡规则里的路径', extraPaths: '组内但未逐条声明的路径',
        covTrend: '覆盖度趋势', mvuNone: '没找到 MVU API（Mvu）——若本卡依赖 MVU，请确认「酒馆助手」与 MVU 脚本已加载。',
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
        secScan: 'Compatibility check', scanNote: 'Runs one pass over every character card: what card-compat can do and why it degrades (pure local computation)', scanRun: 'Run check', scanCopy: 'Copy report', scanIdle: 'Not scanned yet - press Run check', scanRunning: 'Scanning...', scanSum: 'Result', scanOf: ' cards', scanGuard: 'guardable', scanWrite: 'writable', scanRules: 'with rules', colCard: 'Card', colProto: 'Protocol', colCap: 'anchor/data/rules', colVerdict: 'Verdict', scanMore: '(first 200 only; use Copy report for the full list)', scanCopied: 'Report copied', scanCopyFail: 'Copy failed (clipboard unavailable)', v_all: 'All', v_ok: 'guard + check', 'v_guard-only': 'guard only (no variable block)', 'v_no-rules': 'variable block without rules', 'v_read-only': 'read-only protocol', 'v_format-only': 'format tags only (report)', 'v_helper-only': 'rendered by TavernHelper', v_plain: 'plain card (nothing to do)', 'v_dyn-bar': 'dynamic status bar (front-end)', scanDyn: 'Dynamic bars', scanPanel: 'Panels', scanDynYes: 'dynamic', scanNoRules: 'No-rule reasons', scanAlerts: 'Alerts', 'alert_new-dialect': 'possible new dialect', 'alert_disabled-views': 'render regexes disabled', disViews: 'Disabled render regexes', disAuto: ' (auto-enabled by card script)', disWarn: ' (will not render)', 'rs_check-unparsed': 'has check, unparsed', rs_command: 'command style', rs_paths: 'paths list only', rs_structure: 'structure only', rs_schema: 'rules in schema script', rs_prose: 'prose rules', rs_other: 'other style', rs_none: 'no rules in book',
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
        fontFollow: 'Follow ST (default)', fontBig: 'Large', fontBigger: 'Larger', zoom: 'Message zoom', floor: 'Minimum font size',
        lang: 'Panel language', langAuto: 'Auto', stats: 'Stats', log: 'Recent actions',
        noReport: 'Nothing recorded yet (send a message to see the comparison table)', colField: 'Required field', colDone: 'Updated this reply',
        wrotePaths: 'Paths written by the model', unknownPaths: 'Paths outside this card rules', extraPaths: 'Paths under a declared group',
        covTrend: 'Coverage trend', mvuNone: 'MVU API (Mvu) not found - if this card depends on MVU, check that TavernHelper and MVU are loaded.',
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
function invalidateProfile() { profCache = { key: '', prof: null, at: 0 }; }
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
        // 提醒里只列前 12 个（避免几千字的结尾提醒），但覆盖度仍按全部 200 条算
        const text = buildTailReminder(prof, { varSpec: prof.varSpec || '', required: (prof.required || []).slice(0, 12) });
        setExtensionPrompt(PROMPT_KEY, text, text ? extension_prompt_types.IN_CHAT : extension_prompt_types.NONE, 0, false, extension_prompt_roles.SYSTEM);
        if (settings().logActions) console.debug('[card-compat] 注入提醒长度=' + text.length + ' 变量格式=' + ((prof.varSpec || '').length) + ' 字符');
    } catch (e) { console.error('[card-compat] prompt inject failed', e); }
}
/** 懒加载扩展自带的 js-yaml（页面里已有 window.jsyaml 就直接用，避免重复加载） */
const VENDOR_YAML_URL = (() => { try { return new URL('./assets/js-yaml.min.js', import.meta.url).href; } catch (_) { return 'assets/js-yaml.min.js'; } })();
let yamlLibPromise = null;
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
const strictChecked = new Map();   // messageId -> 已校验过的文本，避免同一楼层反复解析
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
        if (strictChecked.get(messageId) === m.mes && !opts.force) return null;
        const lib = await loadYamlLib();
        if (!lib) { stats.yamlStrictSkipped++; log('yaml-strict-skipped', '', 'js-yaml 不可用（assets 加载失败），已跳过严格校验'); renderStats(); return null; }
        const r = strictYamlCheck(m.mes, tags, lib);
        strictChecked.set(messageId, m.mes);
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
async function mvuCanParse(blockText) {
    const M = mvuApi();
    if (!M || typeof M.parseMessage !== 'function') return { checked: false, reason: 'no-api' };
    try { await M.parseMessage(blockText, {}); return { checked: true, ok: true }; }
    catch (e) { return { checked: true, ok: false, reason: String((e && e.message) || e).slice(0, 160) }; }
}
/** 把补出来的补丁真正写回 MVU（否则只追加文本，状态栏不会更新） */
async function applyPatchToMvu(blockText, messageId) {
    const M = mvuApi();
    if (!M || typeof M.parseMessage !== 'function') return { ok: false, reason: '找不到 Mvu API（可点 MVU 面板的「重新处理变量」应用）' };
    try {
        let cur = null;
        try { cur = (typeof M.getCurrentMvuData === 'function') ? M.getCurrentMvuData() : null; } catch (_) {}
        const next = await M.parseMessage(blockText, cur || {});
        if (typeof M.replaceCurrentMvuData === 'function') await M.replaceCurrentMvuData(next);
        else if (typeof M.replaceMvuData === 'function') await M.replaceMvuData(next, { type: 'message', message_id: messageId });
        else return { ok: false, reason: 'Mvu 没有写入接口' };
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
        const r = await mvuCanParse(ex.block);
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
function log(type, tag, extra) {
    recent.unshift({ t: new Date().toLocaleTimeString(), type: type, tag: tag, extra: extra || '' });
    if (recent.length > 40) recent.pop();
    renderStats();
    if (settings()?.logActions) console.debug('[card-compat] ' + type + ' ' + tag + ' ' + (extra || ''));
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
        const sr = stripUndeclaredBlocks(base, { declared: declared, keep: KEEP_BLOCKS });
        if (sr.removed.length) {
            base = sr.text;
            changed = true;
            stats.blocksStripped += sr.removed.length;
            log('undeclared-block-stripped', sr.removed.map((r) => r.tag).join(','), '共 ' + sr.removed.reduce((a, b) => a + b.chars, 0) + ' 字（本卡未声明，会以原文裸露）');
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
    try {
        const req = profile.required || [];
        const hasBlock = m.mes.includes('<UpdateVariable>');
        if (req.length && hasBlock) {
            // 0.4.0：按识别到的协议统计（MVU/JSONPatch 看补丁路径，_.set 看赋值路径）
            const cov = coverageByProtocol(m.mes, req, profile.protocol);
            lastCoverage = cov;
            stats.coverageTotal = cov.total;
            stats.coverageHit = cov.covered.length;
            if (settings().coverageHistory !== false) {
                covHistory.push({ at: Date.now(), id: messageId, hit: cov.covered.length, total: cov.total, blocks: cov.blocks || 1 });
                while (covHistory.length > 40) covHistory.shift();
            }
            const report = { id: messageId, required: req, covered: cov.covered, missing: cov.missing, written: cov.written || [], blocks: cov.blocks || 1, unknownPaths: [], extraPaths: [] };
            if (s.pathWarn !== false) {
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
            lastReport = report;
            log('patch-coverage', cov.covered.length + '/' + cov.total, cov.missing.length ? ('缺: ' + cov.missing.join('、')) : '全部覆盖 ✅');
        }
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
function applyPanelFont() {
    try {
        const el = document.getElementById('cc-panel');
        if (el) el.style.setProperty('--cc-font', String(settings().panelFont || 1) + 'em');
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
    parts.push('<table class="cc-tab"><thead><tr><th>' + escHtml(T('colField')) + '</th><th>' + escHtml(T('colDone')) + '</th></tr></thead><tbody>');
    for (const f of (rep.required || [])) {
        const ok = (rep.covered || []).indexOf(f.path) >= 0;
        parts.push('<tr><td>' + escHtml(f.path) + '</td><td>' + (ok ? '✅' : '❌') + '</td></tr>');
    }
    parts.push('</tbody></table>');
    if (rep.written && rep.written.length) parts.push('<div class="cc-line"><b>' + escHtml(T('wrotePaths')) + '</b>：' + escHtml(rep.written.join('、')) + '</div>');
    if (rep.unknownPaths && rep.unknownPaths.length) parts.push('<div class="cc-line cc-warn"><b>' + escHtml(T('unknownPaths')) + '</b>：' + escHtml(rep.unknownPaths.join('、')) + '</div>');
    if (rep.extraPaths && rep.extraPaths.length) parts.push('<div class="cc-line cc-muted"><b>' + escHtml(T('extraPaths')) + '</b>：' + escHtml(rep.extraPaths.join('、')) + '</div>');
    box.innerHTML = parts.join('');
}
function renderStats() {
    const box = document.getElementById('cc-stats');
    if (box) box.textContent = 'v' + VERSION + ' ｜ 修正 ' + stats.guarded + ' 次（重渲染 ' + stats.rerendered + '）｜ 补锚点 ' + stats.anchorInjected +
        ' ｜ 补闭合 ' + stats.closeRepaired + ' ｜ 数据块缺失 ' + stats.dataMissing + ' ｜ 未更新告警 ' + stats.staleWarned + ' ｜ 未接管 ' + stats.unrendered + ' ｜ 串卡标签 ' + stats.foreignTags + ' ｜ 重复锚点合并 ' + stats.duplicatesCollapsed + ' ｜ 引号修复 ' + stats.quotesFixed + ' ｜ 加引号 ' + stats.scalarsQuoted + ' ｜ YAML 疑点 ' + stats.yamlIssues + ' ｜ 结构修复 ' + stats.yamlStructFixed + ' ｜ 补变量 ' + stats.varFixOk + '/' + stats.varFixTried + ' ｜ 清块 ' + stats.blocksStripped + ' ｜ 多块 ' + stats.multiBlocks + ' ｜ 越界路径 ' + stats.pathUnknown + ' ｜ 联动未生效 ' + stats.nudgeMisses + ' ｜ 格式标签缺 ' + stats.formatMissing + ' ｜ 括号修复 ' + stats.bracketFixed + ' ｜ MVU 解析 ' + stats.mvuParseOk + (stats.mvuParseFail ? ('/失败 ' + stats.mvuParseFail) : '') + ' ｜ YAML 严格 ' + (stats.yamlStrictFail ? ('失败 ' + stats.yamlStrictFail) : ('通过 ' + stats.yamlStrictOk)) +
        (lastCoverage ? (' ｜ 上轮覆盖 ' + lastCoverage.covered.length + '/' + lastCoverage.total + (lastCoverage.missing.length ? '（缺 ' + lastCoverage.missing.slice(0, 4).join('、') + '）' : ' ✅')) : '');
    const logBox = document.getElementById('cc-log');
    if (logBox) logBox.textContent = recent.map((r) => r.t + ' ' + r.type + ' ' + r.tag + (r.extra ? ' — ' + r.extra : '')).join(String.fromCharCode(10));
    const trendBox = document.getElementById('cc-trend');
    if (trendBox) trendBox.textContent = covHistory.length ? (T('covTrend') + '：' + coverageTrendText()) : '';
    renderCoverageTable();
    renderMvuBox();
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
        if (dv.total) extra += ' ｜ ' + escHtml(T('disViews')) + ' ' + dv.total + escHtml(dv.autoEnable ? T('disAuto') : T('disWarn'));
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
    const marks = (r) => (r.bars ? (' ｜ ' + T('scanDyn') + (r.dynBar ? '✦' : '')) : '') + (r.panels ? (' ｜ ' + T('scanPanel')) : '') + (r.ruleStyle ? (' ｜ ' + rsLabel(r.ruleStyle)) : '') + ((r.alerts || []).length ? ' ❗' : '');
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
    for (const r of scanResult.rows) lines.push(r.name + ' | ' + (r.protocol || '-') + ' | ' + r.verdict + ' | 锚点' + r.anchors + ' 数据块' + r.dataTags + ' 规则' + r.required + (r.bars ? (' | 状态栏' + r.bars) : '') + (r.panels ? (' | 面板' + r.panels) : '') + (r.ruleStyle ? (' | 无规则原因:' + r.ruleStyle) : '') + (r.disabledViews ? (' | 禁用渲染正则:' + r.disabledViews + (r.autoEnable ? '(卡自带脚本开启)' : '(不会显示)')) : '') + ((r.alerts || []).length ? (' | 预警:' + r.alerts.join('+')) : ''));
    try { await navigator.clipboard.writeText(lines.join(String.fromCharCode(10))); toast(T('scanCopied'), 'success'); } catch (_) { toast(T('scanCopyFail'), 'warning'); }
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
        '<div id="cc-stats" class="cc-stats"></div>',
        '<div id="cc-trend" class="cc-trend"></div>',
        '<details class="cc-grp" open><summary>① ' + escHtml(T('secGuard')) + '</summary>',
        cb('cc-enabled', 'enabled'), cb('cc-inject-prompt', 'injectPrompt'), cb('cc-inject', 'injectAnchor'), cb('cc-repair', 'repair'), cb('cc-stale', 'stale'),
        "<button id=\"cc-check\" class=\"menu_button\">" + escHtml(T('btnCheck')) + "</button>",
        "<button id=\"cc-refresh\" class=\"menu_button\">" + escHtml(T('btnRefresh')) + "</button>",
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
        '<details><summary>' + escHtml(T('log')) + '</summary><pre id="cc-log" class="cc-log"></pre></details>',
        '</details>',
'<details class="cc-grp"><summary>⑥ ' + escHtml(T('secScan')) + '</summary>',
        '<div class="cc-line cc-muted">' + escHtml(T('scanNote')) + '</div>',
        '<div class="cc-info-actions"><button id="cc-scan-run" class="menu_button">' + escHtml(T('scanRun')) + '</button><button id="cc-scan-copy" class="menu_button">' + escHtml(T('scanCopy')) + '</button></div>',
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
        const r = await mvuCanParse(ex.block);
        if (!r.checked) toast(T('mvuNone'), 'warning');
        else if (r.ok) toast(T('mvuParsed'), 'success');
        else toast(T('mvuUnparsed') + r.reason, 'warning');
        renderMvuBox();
    });
    document.getElementById('cc-scan-run')?.addEventListener('click', () => { runCompatScan(); });
    document.getElementById('cc-scan-copy')?.addEventListener('click', () => { copyScanReport(); });
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
    document.getElementById('cc-check')?.addEventListener('click', () => { guardMessage(chat.length - 1); verifyRendered(chat.length - 1); });
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
    eventSource.on(event_types.MESSAGE_RECEIVED, (id) => { try { guardMessage(id, { rerender: false }); } catch (e) { console.error(e); } });
    // ② 流式：生成结束（hideStopButton 触发），此时 messageId = chat.length-1
    eventSource.on(event_types.GENERATION_ENDED, () => { try { const id = chat.length - 1; if (lastSeen.get(id) !== chat[id]?.mes) guardMessage(id); } catch (e) { console.error(e); } });
    // ③ 渲染后兜底校验
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id) => { try { verifyRendered(id); } catch (_) {} });
    eventSource.on(event_types.CHAT_CHANGED, () => { try { invalidateProfile(); applyFont(); lastSeen.clear(); updatePromptInjection(); setTimeout(normalizeRecent, 600); } catch (_) {} });
    eventSource.on(event_types.MESSAGE_SENT, () => { try { updatePromptInjection(); } catch (_) {} });
    try { updatePromptInjection(); } catch (_) {}
    setTimeout(normalizeRecent, 900);
    try { const info = mvuInfo(); console.log('[card-compat] 已加载 v' + VERSION + '（守护 + 结尾提醒注入 + 历史规范化 + MVU 联动）MVU API=' + (info.api ? '有' : '无')); } catch (_) { console.log('[card-compat] 已加载 v' + VERSION); }
})();
