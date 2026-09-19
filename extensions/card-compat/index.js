// index.js — 卡兼容助手（ST 扩展）v0.1.1
// 三件事：① 锚点守护 ② 数据块守护（绝不改数据内容）③ 消息区字号
// v0.1.1 修复：流式模式下 MESSAGE_RECEIVED 不会触发（ST 用 fromStreaming 跳过），
//             因此补挂 GENERATION_ENDED + CHARACTER_MESSAGE_RENDERED，并在修正后触发重渲染。
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, chat, saveChatDebounced, updateMessageBlock, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { buildProfile, guardText, isStale, normalizeMalformedClosings, detectForeignTags, buildTailReminder, dedupeSelfClosingAnchors, extractVarSpec } from './logic.js';

const NAME = 'card-compat';
const VERSION = '0.2.0';
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
};
const stats = { guarded: 0, rerendered: 0, anchorInjected: 0, closeRepaired: 0, dataMissing: 0, staleWarned: 0, unrendered: 0, foreignTags: 0, duplicatesCollapsed: 0 };
const recent = [];
const lastSeen = new Map();  // messageId -> 上次守护后的文本（续写会改写同一条消息，文本变了就要再守护一次）

const settings = () => extension_settings[NAME];
function profileOf() {
    try {
        const ctx = getContext();
        const chid = ctx?.characterId ?? ctx?.this_chid;
        const ch = ctx?.characters?.[chid];
        const ext = ch?.data?.extensions || ch?.extensions || {};
        const prof = buildProfile(ext);
        // 变量块格式：优先取角色卡的变量更新规则条目（模型照抄成功率最高）
        try {
            const book = ch?.data?.character_book || ch?.character_book;
            const entries = book?.entries || [];
            prof.varSpec = extractVarSpec(entries);
        } catch (_) { prof.varSpec = ''; }
        return prof;
    } catch (_) { return buildProfile({}); }
}
const PROMPT_KEY = 'card-compat-tail';
/** 生成前注入提醒：让模型必须写出当前卡要求的结构块（不点名别的卡的标签） */
function updatePromptInjection() {
    try {
        const s = settings();
        if (!s?.enabled || !s.injectPrompt) { setExtensionPrompt(PROMPT_KEY, "", extension_prompt_types.NONE, 0); return; }
        const prof = profileOf();
        const text = buildTailReminder(prof, { varSpec: prof.varSpec || '' });
        setExtensionPrompt(PROMPT_KEY, text, text ? extension_prompt_types.IN_CHAT : extension_prompt_types.NONE, 0, false, extension_prompt_roles.SYSTEM);
        if (settings().logActions) console.debug('[card-compat] 注入提醒长度=' + text.length + ' 变量格式=' + ((prof.varSpec || '').length) + ' 字符');
    } catch (e) { console.error("[card-compat] prompt inject failed", e); }
}
function log(type, tag, extra) {
    recent.unshift({ t: new Date().toLocaleTimeString(), type, tag, extra: extra || '' });
    if (recent.length > 40) recent.pop();
    renderStats();
    if (settings()?.logActions) console.debug('[card-compat] ' + type + ' ' + tag + ' ' + (extra || ''));
}
function applyFont() {
    const s = settings() || {};
    const css = [
        s.enabled && s.fontZoom && Number(s.fontZoom) !== 1 ? '.mes_text{zoom:' + s.fontZoom + ';}' : '',
        s.enabled && s.fontFloor ? '.mes_text :is(div,span,p,td,th,li,button,small,strong,em){font-size:max(' + s.fontFloor + 'px,1em) !important;}' : '',
    ].filter(Boolean).join('\n');
    let el = document.getElementById('cc-font-style');
    if (!el) { el = document.createElement('style'); el.id = 'cc-font-style'; document.head.appendChild(el); }
    el.textContent = css;
}
/** 返回 true 表示文本被修改并已重渲染 */
function guardMessage(messageId, { rerender = true } = {}) {
    const s = settings();
    if (!s?.enabled || messageId == null) return false;
    const m = chat?.[messageId];
    if (!m || m.is_user || typeof m.mes !== 'string') return false;
    const profile = profileOf();
    const res = guardText(m.mes, profile, s);
    let changed = false;
    // 续写（Continue）会在同一条消息尾部追加，可能追加出第二个占位符 → 合并掉
    if (s.dedupeAnchor) {
        const dd = dedupeSelfClosingAnchors(res.text, profile.anchors || []);
        if (dd.removed.length) { res.text = dd.text; stats.duplicatesCollapsed += dd.removed.length; log('anchor-duplicate-merged', dd.removed.join(',')); changed = true; }
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
        else if (a.type === 'data-missing') { stats.dataMissing++; log('data-missing', a.tag, '本轮面板数据不会更新'); }
        else if (a.type === 'anchor-missing') { log('anchor-missing', a.tag, '未补（关闭了补锚点或该标签在隐藏白名单）'); }
    }
    try {
        const s2 = settings();
        s2.runCount = (s2.runCount || 0) + 1;
        s2.lastRunAt = new Date().toISOString();
        s2.lastRun = { id: messageId, changed, actions: res.actions.map(a => a.type + ':' + a.tag).slice(0, 8), card: (() => { try { const ctx = getContext(); return ctx?.characters?.[ctx?.characterId]?.name || ''; } catch (_) { return ''; } })() };
        saveSettingsDebounced();
    } catch (_) {}
    if (changed) {
        m.mes = res.text;
        stats.guarded++;
        lastSeen.set(messageId, m.mes);
        try { saveChatDebounced(); } catch (_) {}
        if (rerender) {
            stats.rerendered++;
            try { updateMessageBlock(messageId, m, { rerenderMessage: true }); } catch (e) { log('rerender-failed', '', String(e?.message || e)); }
        }
    }
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
        const leaking = tags.filter(t => txt.includes('<' + t) || txt.includes('</' + t + '>'));
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
        let idx = from;
        const step = () => {
            if (idx >= total) { log('auto-scan-done', '最近 ' + n + ' 楼'); return; }
            try { guardMessage(idx); } catch (_) {}
            idx++;
            setTimeout(step, 120);
        };
        step();
    } catch (e) { console.error('[card-compat] normalizeRecent', e); }
}
function renderStats() {
    const box = document.getElementById('cc-stats');
    if (box) box.textContent = 'v' + VERSION + ' ｜ 修正 ' + stats.guarded + ' 次（重渲染 ' + stats.rerendered + '）｜ 补锚点 ' + stats.anchorInjected +
        ' ｜ 补闭合 ' + stats.closeRepaired + ' ｜ 数据块缺失 ' + stats.dataMissing + ' ｜ 未更新告警 ' + stats.staleWarned + ' ｜ 未接管 ' + stats.unrendered + ' ｜ 串卡标签 ' + stats.foreignTags + ' ｜ 重复锚点合并 ' + stats.duplicatesCollapsed;
    const logBox = document.getElementById('cc-log');
    if (logBox) logBox.textContent = recent.map(r => r.t + ' ' + r.type + ' ' + r.tag + (r.extra ? ' — ' + r.extra : '')).join('\n');
}
function buildSettingsUi() {
    const host = document.getElementById('extensions_settings');
    if (!host || document.getElementById('cc-panel')) return;
    const wrap = document.createElement('div');
    wrap.className = 'extension_container';
    wrap.id = 'cc-panel';
    wrap.innerHTML = [
        '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🧩 卡兼容助手 v' + VERSION + '</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>',
        '<div class="inline-drawer-content">',
        '<label class="checkbox_label"><input type="checkbox" id="cc-enabled"><span>启用守护</span></label>',
        '<label class="checkbox_label"><input type="checkbox" id="cc-inject"><span>缺锚点时补一个空锚点</span></label>',
        '<label class="checkbox_label"><input type="checkbox" id="cc-repair"><span>未闭合自动补结束标签</span></label>',
        '<label class="checkbox_label"><input type="checkbox" id="cc-stale"><span>数据疑似未更新时提示</span></label>',
        '<label class="checkbox_label"><input type="checkbox" id="cc-inject-prompt"><span>生成前注入结尾结构块提醒（推荐开）</span></label>',
        '<label>面板字号</label><select id="cc-font"><option value="1">跟随 ST（默认）</option><option value="1.15">大</option><option value="1.3">更大</option></select>',
        '<label>消息区缩放 <span id="cc-zoom-val"></span></label><input type="range" id="cc-zoom" min="0.9" max="1.6" step="0.05">',
        '<label>字号下限 <span id="cc-floor-val"></span></label><input type="range" id="cc-floor" min="0" max="16" step="1">',
        '<button id="cc-check" class="menu_button">自检当前楼层</button>',
        '<div id="cc-stats" class="cc-stats"></div>',
        '<details><summary>最近动作</summary><pre id="cc-log" class="cc-log"></pre></details>',
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
            const fv = document.getElementById('cc-floor-val'); if (fv) fv.textContent = settings().fontFloor ? settings().fontFloor + 'px' : '关闭';
        });
    };
    bind('cc-enabled', 'enabled', true);
    bind('cc-inject', 'injectAnchor', true);
    bind('cc-repair', 'repairClosure', true);
    bind('cc-stale', 'notifyStale', true);
    bind('cc-inject-prompt', 'injectPrompt', true);
    const fontSel = document.getElementById('cc-font');
    if (fontSel) { fontSel.value = String(settings().panelFont || 1); fontSel.addEventListener('change', () => { settings().panelFont = Number(fontSel.value) || 1; saveSettingsDebounced(); applyPanelFont(); }); }
    bind('cc-zoom', 'fontZoom', false);
    bind('cc-floor', 'fontFloor', false);
    const zv = document.getElementById('cc-zoom-val'); if (zv) zv.textContent = Math.round(settings().fontZoom * 100) + '%';
    const fv = document.getElementById('cc-floor-val'); if (fv) fv.textContent = settings().fontFloor ? settings().fontFloor + 'px' : '关闭';
    document.getElementById('cc-check')?.addEventListener('click', () => { guardMessage(chat.length - 1); verifyRendered(chat.length - 1); });
    applyPanelFont();
    renderStats();
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
    // ① 非流式：渲染前
    eventSource.on(event_types.MESSAGE_RECEIVED, (id) => { try { guardMessage(id, { rerender: false }); } catch (e) { console.error(e); } });
    // ② 流式：生成结束（hideStopButton 触发），此时 messageId = chat.length-1
    eventSource.on(event_types.GENERATION_ENDED, () => { try { const id = chat.length - 1; if (lastSeen.get(id) !== chat[id]?.mes) guardMessage(id); } catch (e) { console.error(e); } });
    // ③ 渲染后兜底校验
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id) => { try { verifyRendered(id); } catch (_) {} });
    eventSource.on(event_types.CHAT_CHANGED, () => { try { applyFont(); lastSeen.clear(); updatePromptInjection(); setTimeout(normalizeRecent, 600); } catch (_) {} });
    eventSource.on(event_types.MESSAGE_SENT, () => { try { updatePromptInjection(); } catch (_) {} });
    try { updatePromptInjection(); } catch (_) {}
    setTimeout(normalizeRecent, 900);
    console.log('[card-compat] 已加载 v' + VERSION + '（守护 + 结尾提醒注入 + 历史规范化）');
})();
