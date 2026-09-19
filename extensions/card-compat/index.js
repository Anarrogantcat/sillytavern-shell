// index.js — 卡兼容助手（ST 扩展）v0.1.1
// 三件事：① 锚点守护 ② 数据块守护（绝不改数据内容）③ 消息区字号
// v0.1.1 修复：流式模式下 MESSAGE_RECEIVED 不会触发（ST 用 fromStreaming 跳过），
//             因此补挂 GENERATION_ENDED + CHARACTER_MESSAGE_RENDERED，并在修正后触发重渲染。
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, chat, saveChatDebounced, updateMessageBlock } from '../../../../script.js';
import { buildProfile, guardText, isStale } from './logic.js';

const NAME = 'card-compat';
const VERSION = '0.1.1';
const DEFAULTS = {
    enabled: true,
    injectAnchor: true,      // 缺锚点补一个（默认开；只有卡自己定义过锚点、且不在隐藏白名单里才会补）
    anchorStyle: 'self',     // self=<Tag/>  pair=<Tag></Tag>
    repairClosure: true,
    fontZoom: 1,
    fontFloor: 0,
    notifyStale: true,
    logActions: true,
};
const stats = { guarded: 0, rerendered: 0, anchorInjected: 0, closeRepaired: 0, dataMissing: 0, staleWarned: 0, unrendered: 0 };
const recent = [];
const handled = new Set();   // 已守护处理过的 messageId（防重复/防循环）

const settings = () => extension_settings[NAME];
function profileOf() {
    try {
        const ctx = getContext();
        const chid = ctx?.characterId ?? ctx?.this_chid;
        const ch = ctx?.characters?.[chid];
        const ext = ch?.data?.extensions || ch?.extensions || {};
        return buildProfile(ext);
    } catch (_) { return buildProfile({}); }
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
    for (const a of res.actions) {
        if (a.type === 'anchor-injected') { stats.anchorInjected++; log('anchor-injected', a.tag); changed = true; }
        else if (a.type === 'anchor-close-repaired') { stats.closeRepaired++; log('anchor-close-repaired', a.tag); changed = true; }
        else if (a.type === 'data-close-repaired') { stats.closeRepaired++; log('data-close-repaired', a.tag); changed = true; }
        else if (a.type === 'data-missing') { stats.dataMissing++; log('data-missing', a.tag, '本轮面板数据不会更新'); }
        else if (a.type === 'anchor-missing') { log('anchor-missing', a.tag, '未补（关闭了补锚点或该标签在隐藏白名单）'); }
    }
    if (changed) {
        m.mes = res.text;
        stats.guarded++;
        handled.add(messageId);
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
function renderStats() {
    const box = document.getElementById('cc-stats');
    if (box) box.textContent = 'v' + VERSION + ' ｜ 修正 ' + stats.guarded + ' 次（重渲染 ' + stats.rerendered + '）｜ 补锚点 ' + stats.anchorInjected +
        ' ｜ 补闭合 ' + stats.closeRepaired + ' ｜ 数据块缺失 ' + stats.dataMissing + ' ｜ 未更新告警 ' + stats.staleWarned + ' ｜ 未接管 ' + stats.unrendered;
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
    bind('cc-zoom', 'fontZoom', false);
    bind('cc-floor', 'fontFloor', false);
    const zv = document.getElementById('cc-zoom-val'); if (zv) zv.textContent = Math.round(settings().fontZoom * 100) + '%';
    const fv = document.getElementById('cc-floor-val'); if (fv) fv.textContent = settings().fontFloor ? settings().fontFloor + 'px' : '关闭';
    document.getElementById('cc-check')?.addEventListener('click', () => { guardMessage(chat.length - 1); verifyRendered(chat.length - 1); });
    renderStats();
}
(async function init() {
    extension_settings[NAME] = Object.assign({}, DEFAULTS, extension_settings[NAME] || {});
    buildSettingsUi();
    applyFont();
    // ① 非流式：渲染前
    eventSource.on(event_types.MESSAGE_RECEIVED, (id) => { try { guardMessage(id, { rerender: false }); } catch (e) { console.error(e); } });
    // ② 流式：生成结束（hideStopButton 触发），此时 messageId = chat.length-1
    eventSource.on(event_types.GENERATION_ENDED, () => { try { const id = chat.length - 1; if (!handled.has(id)) guardMessage(id); } catch (e) { console.error(e); } });
    // ③ 渲染后兜底校验
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id) => { try { verifyRendered(id); } catch (_) {} });
    eventSource.on(event_types.CHAT_CHANGED, () => { try { applyFont(); handled.clear(); } catch (_) {} });
    console.log('[card-compat] 已加载 v' + VERSION + '（流式与非流式都会守护）');
})();
