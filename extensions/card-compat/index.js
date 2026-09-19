// index.js — 卡兼容助手（ST 扩展）
// 三件事：① 锚点守护（卡的 <StatusPlaceHolderImpl/> / <StatusBar> / <status!> 等缺失或未闭合时修正）
//        ② 数据块守护（<UpdateVariable> 绝不改内容，只在未闭合时补闭合；缺失只报警不伪造）
//        ③ 消息区字号（zoom + 字号下限，解决卡内写死 px 过小）
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, chat, saveChatDebounced } from '../../../../script.js';
import { buildProfile, guardText, isStale } from './logic.js';

const NAME = 'card-compat';
const DEFAULTS = {
    enabled: true,
    injectAnchor: false,     // 缺锚点是否补（默认关，只报警）
    anchorStyle: 'self',     // self=<Tag/>  pair=<Tag></Tag>
    repairClosure: true,     // 未闭合自动补结束标签
    fontZoom: 1,             // 1 = 100%
    fontFloor: 0,            // 0 = 关闭；12 = 最小 12px
    notifyStale: true,       // 数据疑似未更新时提示
};
const stats = { guarded: 0, anchorInjected: 0, closeRepaired: 0, dataMissing: 0, staleWarned: 0 };
const recent = [];

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
    if (recent.length > 30) recent.pop();
    renderStats();
    if (settings()?.logActions) console.debug('[card-compat]', type, tag, extra || '');
}
function applyFont() {
    const s = settings();
    const css = [
        s.enabled && s.fontZoom && s.fontZoom !== 1 ? '.mes_text{zoom:' + s.fontZoom + ';}' : '',
        s.enabled && s.fontFloor ? '.mes_text :is(div,span,p,td,th,li,button,small,strong,em){font-size:max(' + s.fontFloor + 'px,1em) !important;}' : '',
    ].filter(Boolean).join('\n');
    let el = document.getElementById('cc-font-style');
    if (!el) { el = document.createElement('style'); el.id = 'cc-font-style'; document.head.appendChild(el); }
    el.textContent = css;
}
function guardMessage(messageId) {
    const s = settings();
    if (!s?.enabled) return;
    const m = chat?.[messageId];
    if (!m || m.is_user || typeof m.mes !== 'string') return;
    const profile = profileOf();
    const res = guardText(m.mes, profile, s);
    const actionable = res.actions.filter(a => a.type === 'anchor-injected' || a.type === 'anchor-close-repaired' || a.type === 'data-close-repaired');
    for (const a of res.actions) {
        if (a.type === 'anchor-injected') { stats.anchorInjected++; log('anchor-injected', a.tag); }
        else if (a.type === 'anchor-close-repaired') { stats.closeRepaired++; log('anchor-close-repaired', a.tag); }
        else if (a.type === 'data-close-repaired') { stats.closeRepaired++; log('data-close-repaired', a.tag); }
        else if (a.type === 'data-missing') { stats.dataMissing++; log('data-missing', a.tag, '本轮面板数据不会更新'); }
    }
    if (actionable.length) {
        m.mes = res.text;
        stats.guarded++;
        try { saveChatDebounced(); } catch (_) {}
    }
    if (s.notifyStale) {
        const prev = chat[messageId - 1]?.mes;
        const st = isStale(prev, m.mes);
        if (st.stale) { stats.staleWarned++; log('data-stale', 'freshness', JSON.stringify(st.fields || {}).slice(0, 120)); }
    }
}
// ── 设置界面（纯 DOM 构建，避免模板路径问题）──
function renderStats() {
    const box = document.getElementById('cc-stats');
    if (!box) return;
    box.textContent = '守护 ' + stats.guarded + ' 次 ｜ 补锚点 ' + stats.anchorInjected + ' ｜ 补闭合 ' + stats.closeRepaired +
        ' ｜ 数据块缺失 ' + stats.dataMissing + ' ｜ 数据未更新告警 ' + stats.staleWarned;
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
        '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🧩 卡兼容助手</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>',
        '<div class="inline-drawer-content">',
        '<label class="checkbox_label"><input type="checkbox" id="cc-enabled"><span>启用守护</span></label>',
        '<label class="checkbox_label"><input type="checkbox" id="cc-inject"><span>缺锚点时补一个空锚点（默认关，只报警）</span></label>',
        '<label class="checkbox_label"><input type="checkbox" id="cc-repair"><span>未闭合自动补结束标签</span></label>',
        '<label class="checkbox_label"><input type="checkbox" id="cc-stale"><span>数据疑似未更新时提示</span></label>',
        '<label>消息区缩放 <span id="cc-zoom-val"></span></label><input type="range" id="cc-zoom" min="0.9" max="1.6" step="0.05">',
        '<label>字号下限 <span id="cc-floor-val"></span></label><input type="range" id="cc-floor" min="0" max="16" step="1">',
        '<div id="cc-stats" class="cc-stats"></div>',
        '<details><summary>最近动作</summary><pre id="cc-log" class="cc-log"></pre></details>',
        '</div></div>',
    ].join('');
    host.appendChild(wrap);
    const bind = (id, key, isCheck, fmt) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (isCheck) el.checked = !!settings()[key]; else el.value = settings()[key];
        el.addEventListener('input', () => {
            settings()[key] = isCheck ? el.checked : Number(el.value);
            saveSettingsDebounced();
            applyFont(); renderStats();
            if (fmt) fmt();
        });
    };
    bind('cc-enabled', 'enabled', true);
    bind('cc-inject', 'injectAnchor', true);
    bind('cc-repair', 'repairClosure', true);
    bind('cc-stale', 'notifyStale', true);
    bind('cc-zoom', 'fontZoom', false, () => { const v = document.getElementById('cc-zoom-val'); if (v) v.textContent = Math.round(settings().fontZoom * 100) + '%'; });
    bind('cc-floor', 'fontFloor', false, () => { const v = document.getElementById('cc-floor-val'); if (v) v.textContent = settings().fontFloor ? settings().fontFloor + 'px' : '关闭'; });
    const zv = document.getElementById('cc-zoom-val'); if (zv) zv.textContent = Math.round(settings().fontZoom * 100) + '%';
    const fv = document.getElementById('cc-floor-val'); if (fv) fv.textContent = settings().fontFloor ? settings().fontFloor + 'px' : '关闭';
    renderStats();
}
(async function init() {
    extension_settings[NAME] = Object.assign({}, DEFAULTS, extension_settings[NAME] || {});
    buildSettingsUi();
    applyFont();
    eventSource.on(event_types.MESSAGE_RECEIVED, (id) => { try { guardMessage(id); } catch (e) { console.error('[card-compat]', e); } });
    eventSource.on(event_types.CHAT_CHANGED, () => { try { applyFont(); } catch (_) {} });
    console.log('[card-compat] 已加载 v0.1.0');
})();
