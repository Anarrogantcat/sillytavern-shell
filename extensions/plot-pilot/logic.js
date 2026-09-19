// logic.js — 剧情推进器 Plot Pilot · 纯逻辑层
// 设计原则：本文件不 import 任何 SillyTavern / DOM / 酒馆助手 的东西，
// 因此可以在 Node 里直接跑夹具测试（scripts/plot-pilot-test.mjs），
// 后续要加新策略（新卡型探测、新按钮、自动连发…）都改这里 + 加断言。

export const EXT_ID = 'plot-pilot';
export const VERSION = '0.1.0';

/** 配置默认值。新增字段请同时写进 sanitizeConfig 的白名单与 README 表格。 */
export const DEFAULTS = {
    enabled: true,                 // 总开关
    showBar: true,                 // 是否在发送栏上方注入按钮条
    continueLabel: '▶ 续写',        // 按钮文案（可改）
    advanceLabel: '⏭ 推进节点',
    continueText: '（按照当前剧情继续推演）',                                  // 点「续写」实际发送的内容
    advanceText: '请根据当前 {var}，推进至下一个 step',                        // 点「推进节点」发送的内容，{var} 会被替换成探测到的变量名
    advanceTextFallback: '（推进到下一个剧情节点）',                            // 没有探测到变量名时的兜底文案
    showAdvanceWhenUnknown: true,  // 只有弱信号（如卡里仅出现「剧本」二字）时是否也显示推进按钮（默认开＝沿用旧脚本行为）
    sendMode: 'auto',              // auto | api | dom，见 pickSendStrategy
    clickGuardMs: 800,             // 防连点窗口
    waitSendableMs: 2000,          // dom 模式下等待发送按钮可用的最长时间
    pollMs: 400,                   // DOM 变化后的重注入节流
    ignoreLegacy: false,           // 检测到旧的酒馆助手「继续按钮」脚本时是否仍然工作
    logLimit: 40,
    cards: {},                     // 每卡覆盖：{ [卡名]: { showContinue, showAdvance, continueText, advanceText } }
    // —— 运行时心跳（由 index.js 写入，便于排查「装没装、跑没跑」）——
    loadedAt: '',
    loadedVersion: '',
    runCount: 0,
    lastAction: '',
};

/** 强信号：出现即认定「这张卡有剧本/蓝图推进系统」，并尽量取到真实变量名 */
export const STRONG_KEYS = [
    'blueprint_controller',
    'blueprint_manager',
    'blueprint_state',
    'blueprint_data',
    'blueprint',
    '剧本控制器',
    '剧本控制',
    '剧本管理器',
    '剧情蓝图',
    '剧情控制器',
    '剧情推进器',
];

/** 弱信号：只说明「可能跟剧本/节点有关」，默认不显示推进按钮，避免发出模型看不懂的指令 */
export const WEAK_HINTS = [
    '推进至下一个 step',
    '推进至下个 step',
    '推进至下一个step',
    '推进到下一个 step',
    '下一个 step',
    '推进剧本',
    '剧情节点',
    '章节推进',
    '阶段推进',
    '推进剧情',
    '剧本',
    '蓝图',
];

const SEND_MODES = ['auto', 'api', 'dom'];

function asBool(v, dflt) { return typeof v === 'boolean' ? v : dflt; }
function asText(v, dflt, max) {
    if (typeof v !== 'string') return dflt;
    const t = v.length > max ? v.slice(0, max) : v;
    return t;
}
function clampInt(v, lo, hi, dflt) {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * 探测一张卡是否带「剧本 / 蓝图」推进系统。
 * @param {{ text?: string, keys?: string[] }} profile 卡的文本（描述/世界书/扩展脚本）与可选的顶层键名
 * @returns {{ has: boolean, confidence: 'strong'|'weak'|'none', varName: string|null, hits: string[] }}
 */
export function detectBlueprint(profile = {}) {
    const text = String(profile.text || '');
    const keys = Array.isArray(profile.keys) ? profile.keys.map(String) : [];

    // ① 扩展数据里的顶层键名（最精确）
    for (const k of keys) {
        for (const s of STRONG_KEYS) {
            if (k === s || k.includes(s)) return { has: true, confidence: 'strong', varName: s, hits: [k] };
        }
    }
    // ② 文本里的强信号（角色卡描述 / 世界书 / 扩展脚本正文）
    for (const s of STRONG_KEYS) {
        if (text.includes(s)) return { has: true, confidence: 'strong', varName: s, hits: [s] };
    }
    // ③ 弱信号
    const hits = [];
    for (const h of WEAK_HINTS) {
        if (text.includes(h)) hits.push(h);
        if (hits.length >= 3) break;
    }
    if (hits.length) return { has: true, confidence: 'weak', varName: null, hits: hits };
    return { has: false, confidence: 'none', varName: null, hits: [] };
}

/** 把探测结果转成一句人话（面板 / 日志用） */
export function formatDetection(det) {
    if (!det || !det.has) return '无剧本系统（两个按钮里只显示「续写」）';
    if (det.confidence === 'strong') {
        return '有剧本系统' + (det.varName ? '（变量名：' + det.varName + '）' : '（未取到变量名，用通用文案）');
    }
    return '疑似有剧本系统（弱信号：' + (det.hits || []).join('、') + '）';
}

/** 「推进节点」实际发送的文案：把 {var} 换成真实变量名，没有则用「剧情蓝图」/兜底文案 */
export function buildAdvanceText(cfg, det) {
    const name = (det && det.varName) || '剧情蓝图';
    const tmpl = asText(cfg && cfg.advanceText, DEFAULTS.advanceText, 400);
    if (det && det.varName) return tmpl.split('{var}').join(name);
    if (tmpl.indexOf('{var}') >= 0) return tmpl.split('{var}').join(name);
    return tmpl;
}

/**
 * 点「推进节点」实际发送什么：
 *   有探测信号 → advanceText 模板（{var} 换成真实变量名，取不到就写「剧情蓝图」）
 *   完全无信号（用户按卡强制显示）→ advanceTextFallback 兜底文案
 */
export function advancePayload(cfg, det) {
    if (det && det.has) return buildAdvanceText(cfg, det);
    return asText(cfg && cfg.advanceTextFallback, DEFAULTS.advanceTextFallback, 2000);
}

/**
 * 合并「全局配置 + 本卡覆盖」。
 * 卡名不存在或没有覆盖时，返回全局配置的一份浅拷贝。
 */
export function resolveCard(cfg, cardName) {
    const c = sanitizeConfig(cfg);
    const key = String(cardName || '');
    const raw = key && c.cards && typeof c.cards === 'object' ? c.cards[key] : null;
    const out = Object.assign({}, c, { cardName: key });
    if (raw && typeof raw === 'object') {
        if (typeof raw.showContinue === 'boolean') out.showContinue = raw.showContinue;
        if (typeof raw.showAdvance === 'boolean') out.showAdvance = raw.showAdvance;
        if (typeof raw.continueText === 'string' && raw.continueText) out.continueText = raw.continueText;
        if (typeof raw.advanceText === 'string' && raw.advanceText) out.advanceText = raw.advanceText;
    }
    return out;
}

/** 推进按钮该不该显示 */
export function shouldShowAdvance(eff, det) {
    if (!det || !det.has) return false;
    if (typeof eff.showAdvance === 'boolean') return eff.showAdvance;
    if (det.confidence === 'strong') return true;
    return !!eff.showAdvanceWhenUnknown;
}

/** 校验并补齐配置：坏值一律回落到默认值，绝不让页面因为一条脏配置崩掉 */
export function sanitizeConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = Object.assign({}, DEFAULTS, src);
    out.enabled = asBool(src.enabled, DEFAULTS.enabled);
    out.showBar = asBool(src.showBar, DEFAULTS.showBar);
    out.showAdvanceWhenUnknown = asBool(src.showAdvanceWhenUnknown, DEFAULTS.showAdvanceWhenUnknown);
    out.ignoreLegacy = asBool(src.ignoreLegacy, DEFAULTS.ignoreLegacy);
    out.continueLabel = asText(src.continueLabel, DEFAULTS.continueLabel, 40);
    out.advanceLabel = asText(src.advanceLabel, DEFAULTS.advanceLabel, 40);
    out.continueText = asText(src.continueText, DEFAULTS.continueText, 2000);
    out.advanceText = asText(src.advanceText, DEFAULTS.advanceText, 2000);
    out.advanceTextFallback = asText(src.advanceTextFallback, DEFAULTS.advanceTextFallback, 2000);
    out.sendMode = SEND_MODES.indexOf(src.sendMode) >= 0 ? src.sendMode : DEFAULTS.sendMode;
    out.clickGuardMs = clampInt(src.clickGuardMs, 0, 10000, DEFAULTS.clickGuardMs);
    out.waitSendableMs = clampInt(src.waitSendableMs, 0, 30000, DEFAULTS.waitSendableMs);
    out.pollMs = clampInt(src.pollMs, 100, 5000, DEFAULTS.pollMs);
    out.logLimit = clampInt(src.logLimit, 5, 500, DEFAULTS.logLimit);
    out.loadedAt = typeof src.loadedAt === 'string' ? src.loadedAt : DEFAULTS.loadedAt;
    out.loadedVersion = typeof src.loadedVersion === 'string' ? src.loadedVersion : DEFAULTS.loadedVersion;
    out.runCount = clampInt(src.runCount, 0, 1e9, 0);
    out.lastAction = asText(src.lastAction, '', 300);
    const cards = {};
    if (src.cards && typeof src.cards === 'object' && !Array.isArray(src.cards)) {
        for (const name of Object.keys(src.cards)) {
            const v = src.cards[name];
            if (!v || typeof v !== 'object') continue;
            const e = {};
            if (typeof v.showContinue === 'boolean') e.showContinue = v.showContinue;
            if (typeof v.showAdvance === 'boolean') e.showAdvance = v.showAdvance;
            if (typeof v.continueText === 'string' && v.continueText) e.continueText = asText(v.continueText, '', 2000);
            if (typeof v.advanceText === 'string' && v.advanceText) e.advanceText = asText(v.advanceText, '', 2000);
            if (Object.keys(e).length) cards[String(name)] = e;
        }
    }
    out.cards = cards;
    return out;
}

/**
 * 旧版「继续按钮」是酒馆助手脚本（window.YDContinue / #yd-quick-continue-wrapper）。
 * 同时启用会造成两套按钮，因此默认让本扩展进入待命状态，并在面板里提示去停用它。
 */
export function legacyStandby(cfg, legacyPresent) {
    if (!legacyPresent) return { standby: false, reason: '' };
    if (cfg && cfg.ignoreLegacy) return { standby: false, reason: '已忽略旧脚本冲突（配置 ignoreLegacy=true）' };
    return {
        standby: true,
        reason: '检测到旧的酒馆助手「继续按钮」脚本仍在运行：请在 酒馆助手 → 脚本 里停用它，或在下方勾选「忽略旧脚本」后刷新。',
    };
}

/** 由 { hasGlobals, hasBarElement } 判断旧脚本是否在场 */
export function detectLegacySignals(probe) {
    const p = probe || {};
    return !!(p.hasGlobals || p.hasBarElement);
}

/** 决定用哪条发送通道：api（直接调用 ST 的 Generate）优先，dom（模拟点击）兜底 */
export function pickSendStrategy(mode, caps) {
    const c = caps || {};
    if (mode === 'api') return c.api ? 'api' : 'dom';
    if (mode === 'dom') return 'dom';
    return c.api ? 'api' : 'dom';
}

/** 面板上那句状态汇总 */
export function summarizeState(input) {
    const s = input || {};
    const parts = [];
    parts.push(s.det && s.det.has ? '探测：' + formatDetection(s.det) : '探测：无剧本系统');
    parts.push('本卡：' + (s.cardName || '（未选择角色）'));
    if (s.standby) parts.push('状态：待命（旧脚本冲突）');
    else if (!s.enabled) parts.push('状态：已停用');
    else parts.push('状态：工作中');
    parts.push('发送通道：' + (s.strategy || '-'));
    return parts.join(' ｜ ');
}
