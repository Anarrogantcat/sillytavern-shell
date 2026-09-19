// index.js — 剧情推进器 Plot Pilot（SillyTavern 扩展）
// 由来：原「继续按钮」是酒馆助手脚本，配置存 localStorage、无法随 ST 设置一起备份，
//       也不好扩展。本扩展把它做成 ST 原生扩展：
//       ① 配置进 extension_settings（跟随 ST 设置持久化 + 备份）
//       ② 逻辑与界面分离（logic.js 可在 Node 里跑夹具）
//       ③ 公开 window.PlotPilot，方便后续用脚本或别的扩展继续扩展
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, Generate } from '../../../../script.js';
import {
    EXT_ID, VERSION, DEFAULTS, sanitizeConfig, detectBlueprint, detectLegacySignals,
    formatDetection, advancePayload, resolveCard, shouldShowAdvance, legacyStandby,
    pickSendStrategy, summarizeState,
} from './logic.js';

const NAME = EXT_ID;
const LEGACY_CFG_KEY = 'yd_continue_cfg_v2';
const settings = () => extension_settings[NAME];

const recent = [];
let standby = { standby: false, reason: '' };
let lastDet = { has: false, confidence: 'none', varName: null, hits: [] };
let lastEff = null;
let lastStrategy = '-';
let busy = false;
let injectTimer = null;

function log(type, tag, extra) {
    recent.unshift({ t: new Date().toLocaleTimeString(), type: type, tag: tag, extra: extra || '' });
    const limit = (settings() && settings().logLimit) || 40;
    while (recent.length > limit) recent.pop();
    renderState();
    if (settings() && settings().enabled) console.debug('[plot-pilot] ' + type + ' ' + tag + ' ' + (extra || ''));
}

function ctx() { try { return getContext(); } catch (_) { return null; } }

function currentCard() {
    try {
        const c = ctx();
        const list = (c && c.characters) || [];
        const id = (c && (c.characterId !== undefined ? c.characterId : c.this_chid));
        return list[id] || null;
    } catch (_) { return null; }
}

function cardName() {
    const ch = currentCard();
    return (ch && (ch.name || (ch.data && ch.data.name))) || '';
}

/** 把当前卡的文本与键名整理成探测输入（文本截断，避免大卡卡顿） */
function cardProfile() {
    const ch = currentCard();
    if (!ch) return { text: '', keys: [] };
    const d = ch.data || ch;
    const parts = [];
    const keys = [];
    try {
        parts.push(String(d.description || ''));
        parts.push(String(d.personality || ''));
        parts.push(String(d.scenario || ''));
        parts.push(String(d.first_mes || '').slice(0, 20000));
        parts.push(String(d.mes_example || '').slice(0, 20000));
        parts.push(String(d.system_prompt || ''));
        parts.push(String(d.post_history_instructions || ''));
    } catch (_) {}
    try {
        const ext = d.extensions || {};
        keys.push.apply(keys, Object.keys(ext));
        const th = ext.tavern_helper;
        if (th && th.variables && typeof th.variables === 'object') keys.push.apply(keys, Object.keys(th.variables));
        if (th && Array.isArray(th.scripts)) {
            for (const s of th.scripts) { keys.push(String(s.name || '')); parts.push(String(s.content || '').slice(0, 60000)); }
        }
        parts.push(JSON.stringify(ext).slice(0, 120000));
    } catch (_) {}
    try {
        const entries = (d.character_book && d.character_book.entries) || [];
        for (const e of entries) {
            parts.push(String(e.comment || ''));
            parts.push(String(e.content || '').slice(0, 40000));
        }
    } catch (_) {}
    return { text: parts.join('\n').slice(0, 400000), keys: keys };
}

function detect() {
    lastDet = detectBlueprint(cardProfile());
    return lastDet;
}

function legacyProbe() {
    let hasGlobals = false;
    try { hasGlobals = typeof window.YDContinue !== 'undefined' && !!window.YDContinue; } catch (_) {}
    let hasBarElement = false;
    try { hasBarElement = !!document.getElementById('yd-quick-continue-wrapper'); } catch (_) {}
    return { hasGlobals: hasGlobals, hasBarElement: hasBarElement };
}

/** 一次性把旧酒馆助手脚本的 localStorage 配置搬过来，避免用户重配 */
function migrateLegacyConfig() {
    const s = settings();
    if (s.migratedLegacyConfig) return;
    let moved = [];
    try {
        const raw = localStorage.getItem(LEGACY_CFG_KEY);
        if (raw) {
            const old = JSON.parse(raw);
            if (old && typeof old === 'object') {
                if (typeof old.continueText === 'string' && old.continueText && old.continueText !== DEFAULTS.continueText) { s.continueText = old.continueText; moved.push('continueText'); }
                if (typeof old.advanceText === 'string' && old.advanceText && old.advanceText !== DEFAULTS.advanceText) { s.advanceText = old.advanceText; moved.push('advanceText'); }
                if (typeof old.advanceTextFallback === 'string' && old.advanceTextFallback) { s.advanceTextFallback = old.advanceTextFallback; moved.push('advanceTextFallback'); }
                if (typeof old.showAdvanceWhenUnknown === 'boolean') { s.showAdvanceWhenUnknown = old.showAdvanceWhenUnknown; moved.push('showAdvanceWhenUnknown'); }
                if (typeof old.pollMs === 'number') { s.pollMs = old.pollMs; moved.push('pollMs'); }
            }
        }
    } catch (_) {}
    s.migratedLegacyConfig = true;
    extension_settings[NAME] = sanitizeConfig(s);
    saveSettingsDebounced();
    if (moved.length) log('legacy-config-migrated', moved.join(','), '已从酒馆助手脚本的 localStorage 配置搬过来');
}

function isGenerating() {
    try {
        const b = document.getElementById('send_but');
        if (!b) return false;
        return !!(b.classList.contains('disabled') || b.disabled);
    } catch (_) { return false; }
}

function toastInfo(msg) {
    try { if (typeof toastr !== 'undefined') toastr.info(msg); } catch (_) {}
}
function toastWarn(msg) {
    try { if (typeof toastr !== 'undefined') toastr.warning(msg); } catch (_) {}
}

/** API 通道：把文本放进输入框后直接调用 ST 的 Generate（内部会创建用户消息并开始生成） */
async function sendViaApi(text) {
    const ta = document.getElementById('send_textarea');
    if (!ta) throw new Error('找不到 #send_textarea');
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    // Generate 内部读取输入框内容创建用户消息，生成完再清空输入框
    const clear = () => {
        try {
            const box = document.getElementById('send_textarea');
            if (box && box.value === text) { box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); }
        } catch (_) {}
    };
    try { eventSource.once(event_types.MESSAGE_SENT, clear); } catch (_) { setTimeout(clear, 1500); }
    setTimeout(clear, 8000);
    await Generate('normal');
}

/** DOM 通道（旧脚本的做法，作为兜底）：写输入框 → 等发送按钮可用 → 点击 */
async function sendViaDom(text) {
    const ta = document.getElementById('send_textarea');
    const btn = document.getElementById('send_but');
    if (!ta || !btn) throw new Error('找不到 #send_textarea / #send_but');
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const deadline = Date.now() + ((settings() && settings().waitSendableMs) || 0);
    while (Date.now() < deadline) {
        if (!(btn.classList.contains('disabled') || btn.disabled)) break;
        await new Promise((r) => setTimeout(r, 100));
    }
    btn.click();
}

async function send(text, kind) {
    const s = settings();
    if (!s || !s.enabled) return;
    if (standby.standby) { toastWarn('剧情推进器处于待命状态：' + standby.reason); return; }
    if (busy) return;
    if (!text || !String(text).trim()) return;
    if (isGenerating()) { log('skip', kind, '正在生成中，已忽略本次点击'); toastInfo('正在生成中，稍后再点'); return; }
    busy = true;
    s.runCount = (s.runCount || 0) + 1;
    saveSettingsDebounced();
    try {
        const caps = { api: typeof Generate === 'function', dom: !!(document.getElementById('send_textarea') && document.getElementById('send_but')) };
        lastStrategy = pickSendStrategy(s.sendMode, caps);
        const payload = String(text);
        if (lastStrategy === 'api') await sendViaApi(payload);
        else await sendViaDom(payload);
        log('sent', kind, payload.slice(0, 60) + (payload.length > 60 ? '…' : '') + '（' + lastStrategy + '）');
    } catch (e) {
        log('send-failed', kind, String((e && e.message) || e));
        console.error('[plot-pilot] send failed', e);
        try {
            if (pickSendStrategy(settings().sendMode, { api: true, dom: true }) !== 'dom') await sendViaDom(String(text));
        } catch (_) {}
    } finally {
        setTimeout(() => { busy = false; }, (settings() && settings().clickGuardMs) || 0);
        renderState();
    }
}

/* ------------------------------- 界面：按钮条 ------------------------------- */

function ensureBar() {
    let bar = document.getElementById('plot-pilot-bar');
    if (bar) return bar;
    const form = document.getElementById('send_form');
    if (!form) return null;
    bar = document.createElement('div');
    bar.id = 'plot-pilot-bar';
    const b1 = document.createElement('div');
    b1.id = 'plot-pilot-continue';
    b1.className = 'pp-btn';
    const b2 = document.createElement('div');
    b2.id = 'plot-pilot-advance';
    b2.className = 'pp-btn pp-advance';
    b1.addEventListener('click', () => {
        const eff = resolveCard(settings(), cardName());
        send(eff.continueText, 'continue');
    });
    b2.addEventListener('click', () => {
        const eff = resolveCard(settings(), cardName());
        const det = lastDet && lastDet.has ? lastDet : detect();
        send(advancePayload(eff, det), 'advance');
    });
    bar.appendChild(b1);
    bar.appendChild(b2);
    form.prepend(bar);
    log('bar-injected', '', '按钮条已注入发送栏上方');
    return bar;
}

function applyBar() {
    const s = settings();
    if (!s || !s.showBar || !s.enabled || standby.standby) {
        const old = document.getElementById('plot-pilot-bar');
        if (old) old.remove();
        return;
    }
    const bar = ensureBar();
    if (!bar) return;
    const eff = lastEff || resolveCard(s, cardName());
    const det = lastDet || detect();
    const b1 = document.getElementById('plot-pilot-continue');
    const b2 = document.getElementById('plot-pilot-advance');
    if (b1) { b1.textContent = eff.continueLabel; b1.title = '发送：' + eff.continueText; b1.style.display = eff.showContinue === false ? 'none' : ''; }
    if (b2) {
        const show = shouldShowAdvance(eff, det);
        b2.style.display = show ? '' : 'none';
        b2.textContent = eff.advanceLabel;
        b2.title = det.has ? ('推进剧情节点（' + formatDetection(det) + '）') : '推进剧情节点（通用文案）';
    }
    const gen = isGenerating();
    for (const el of [b1, b2]) { if (el) el.classList.toggle('pp-disabled', gen); }
}

/** 刷新：重新探测 + 重算本卡设置 + 重画按钮条与面板 */
function refresh() {
    const s = settings();
    const legacy = detectLegacySignals(legacyProbe());
    standby = legacyStandby(s, legacy);
    if (standby.standby) log('standby', 'legacy-script', standby.reason);
    detect();
    lastEff = resolveCard(s, cardName());
    applyBar();
    renderState();
    syncCardFields();
    return { det: lastDet, eff: lastEff, standby: standby };
}

/* ------------------------------- 界面：设置面板 ------------------------------- */

function renderState() {
    const box = document.getElementById('pp-state');
    if (box) {
        box.textContent = summarizeState({
            det: lastDet, cardName: cardName(), pending: busy,
            standby: standby.standby, enabled: settings().enabled, strategy: lastStrategy,
        }) + ' ｜ 运行 ' + (settings().runCount || 0) + ' 次 ｜ v' + VERSION;
    }
    const warn = document.getElementById('pp-warn');
    if (warn) { warn.textContent = standby.standby ? ('⚠ ' + standby.reason) : ''; warn.style.display = standby.standby ? '' : 'none'; }
    const logBox = document.getElementById('pp-log');
    if (logBox) logBox.textContent = recent.map((r) => r.t + ' ' + r.type + ' ' + r.tag + (r.extra ? ' — ' + r.extra : '')).join('\n');
}

function syncCardFields() {
    const name = cardName();
    const el = document.getElementById('pp-card-name');
    if (el) el.textContent = name ? ('当前卡：' + name) : '当前卡：（未选择角色）';
    const c = (settings().cards || {})[name] || {};
    const sc = document.getElementById('pp-card-continue');
    const sa = document.getElementById('pp-card-advance');
    if (sc) sc.value = c.showContinue === true ? 'show' : (c.showContinue === false ? 'hide' : 'inherit');
    if (sa) sa.value = c.showAdvance === true ? 'show' : (c.showAdvance === false ? 'hide' : 'inherit');
    const ct = document.getElementById('pp-card-continue-text');
    const at = document.getElementById('pp-card-advance-text');
    if (ct) ct.value = c.continueText || '';
    if (at) at.value = c.advanceText || '';
}

function writeCard(patch) {
    const name = cardName();
    if (!name) return;
    const s = settings();
    const cards = Object.assign({}, s.cards || {});
    const cur = Object.assign({}, cards[name] || {});
    for (const k of Object.keys(patch)) {
        const v = patch[k];
        if (v === null || v === undefined || v === '') delete cur[k];
        else cur[k] = v;
    }
    if (Object.keys(cur).length) cards[name] = cur;
    else delete cards[name];
    s.cards = cards;
    saveSettingsDebounced();
    refresh();
}

function bindText(id, key, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = settings()[key];
    el.addEventListener('input', () => { settings()[key] = el.value; saveSettingsDebounced(); if (onChange) onChange(); });
}
function bindCheck(id, key, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!settings()[key];
    el.addEventListener('input', () => { settings()[key] = el.checked; saveSettingsDebounced(); if (onChange) onChange(); });
}

function buildSettingsUi() {
    const host = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
    if (!host || document.getElementById('pp-panel')) return;
    const wrap = document.createElement('div');
    wrap.className = 'extension_container';
    wrap.id = 'pp-panel';
    wrap.innerHTML = [
        '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🎬 剧情推进器 Plot Pilot v' + VERSION + '</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>',
        '<div class="inline-drawer-content">',
        '<div id="pp-state" class="pp-state"></div>',
        '<div id="pp-warn" class="pp-warn" style="display:none"></div>',
        '<label class="checkbox_label"><input type="checkbox" id="pp-enabled"><span>启用</span></label>',
        '<label class="checkbox_label"><input type="checkbox" id="pp-bar"><span>在发送栏上方显示按钮</span></label>',
        '<label>「续写」按钮文字</label><input type="text" id="pp-continue-label">',
        '<label>「续写」发送内容</label><input type="text" id="pp-continue-text">',
        '<label>「推进节点」按钮文字</label><input type="text" id="pp-advance-label">',
        '<label>「推进节点」发送内容（{var} = 探测到的变量名）</label><input type="text" id="pp-advance-text">',
        '<label>没有探测到变量时的兜底内容</label><input type="text" id="pp-advance-fallback">',
        '<label class="checkbox_label"><input type="checkbox" id="pp-advance-unknown"><span>卡里只有弱信号（如只出现「剧本」）时也显示「推进节点」</span></label>',
        '<label>发送通道</label><select id="pp-send-mode"><option value="auto">自动（优先 API，失败退回模拟点击）</option><option value="api">只用 API（ST 内部发送）</option><option value="dom">只用模拟点击</option></select>',
        '<label>防连点窗口 <span id="pp-guard-val"></span></label><input type="range" id="pp-guard" min="0" max="3000" step="100">',
        '<label class="checkbox_label"><input type="checkbox" id="pp-ignore-legacy"><span>忽略旧「继续按钮」脚本冲突（勾选后本扩展照常工作）</span></label>',
        '<fieldset><legend>本卡设置</legend>',
        '<div id="pp-card-name" class="pp-sub"></div>',
        '<label>「续写」按钮</label><select id="pp-card-continue"><option value="inherit">跟随全局</option><option value="show">本卡显示</option><option value="hide">本卡隐藏</option></select>',
        '<label>「推进节点」按钮</label><select id="pp-card-advance"><option value="inherit">跟随全局</option><option value="show">本卡显示</option><option value="hide">本卡隐藏</option></select>',
        '<label>本卡「续写」内容（留空 = 跟随全局）</label><input type="text" id="pp-card-continue-text">',
        '<label>本卡「推进节点」内容（留空 = 跟随全局）</label><input type="text" id="pp-card-advance-text">',
        '</fieldset>',
        '<button id="pp-recheck" class="menu_button">重新探测当前卡</button>',
        '<button id="pp-reset-card" class="menu_button">清除本卡设置</button>',
        '<details><summary>最近动作</summary><pre id="pp-log" class="pp-log"></pre></details>',
        '</div></div>',
    ].join('');
    host.appendChild(wrap);

    bindCheck('pp-enabled', 'enabled', () => { applyBar(); renderState(); });
    bindCheck('pp-bar', 'showBar', () => { applyBar(); });
    bindCheck('pp-advance-unknown', 'showAdvanceWhenUnknown', () => { applyBar(); });
    bindCheck('pp-ignore-legacy', 'ignoreLegacy', () => { refresh(); });
    bindText('pp-continue-label', 'continueLabel', () => applyBar());
    bindText('pp-advance-label', 'advanceLabel', () => applyBar());
    bindText('pp-continue-text', 'continueText', () => applyBar());
    bindText('pp-advance-text', 'advanceText', () => applyBar());
    bindText('pp-advance-fallback', 'advanceTextFallback', () => applyBar());

    const mode = document.getElementById('pp-send-mode');
    if (mode) { mode.value = settings().sendMode; mode.addEventListener('change', () => { settings().sendMode = mode.value; saveSettingsDebounced(); }); }
    const guard = document.getElementById('pp-guard');
    if (guard) {
        guard.value = String(settings().clickGuardMs);
        const label = document.getElementById('pp-guard-val');
        if (label) label.textContent = settings().clickGuardMs + 'ms';
        guard.addEventListener('input', () => {
            settings().clickGuardMs = Number(guard.value) || 0;
            saveSettingsDebounced();
            const l2 = document.getElementById('pp-guard-val');
            if (l2) l2.textContent = settings().clickGuardMs + 'ms';
        });
    }
    const cardSel = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
            if (el.value === 'inherit') writeCard({ [key]: null });
            else writeCard({ [key]: el.value === 'show' });
        });
    };
    cardSel('pp-card-continue', 'showContinue');
    cardSel('pp-card-advance', 'showAdvance');
    const ccT = document.getElementById('pp-card-continue-text');
    if (ccT) ccT.addEventListener('change', () => writeCard({ continueText: ccT.value }));
    const ccA = document.getElementById('pp-card-advance-text');
    if (ccA) ccA.addEventListener('change', () => writeCard({ advanceText: ccA.value }));

    const re = document.getElementById('pp-recheck');
    if (re) re.addEventListener('click', () => { const r = refresh(); log('recheck', formatDetection(r.det)); });
    const rs = document.getElementById('pp-reset-card');
    if (rs) rs.addEventListener('click', () => { const n = cardName(); if (!n) return; const s = settings(); const cards = Object.assign({}, s.cards || {}); delete cards[n]; s.cards = cards; saveSettingsDebounced(); syncCardFields(); refresh(); log('card-settings-cleared', n); });

    syncCardFields();
    renderState();
}

/* --------------------------------- 启动 --------------------------------- */

(function init() {
    extension_settings[NAME] = sanitizeConfig(Object.assign({}, DEFAULTS, extension_settings[NAME] || {}));
    try {
        settings().loadedAt = new Date().toISOString();
        settings().loadedVersion = VERSION;
        saveSettingsDebounced();
    } catch (_) {}
    migrateLegacyConfig();
    buildSettingsUi();
    refresh();

    try {
        eventSource.on(event_types.CHAT_CHANGED, () => { try { setTimeout(refresh, 300); } catch (_) {} });
        eventSource.on(event_types.GENERATION_STARTED, () => { try { applyBar(); } catch (_) {} });
        eventSource.on(event_types.GENERATION_ENDED, () => { try { applyBar(); } catch (_) {} });
        eventSource.on(event_types.GENERATION_STOPPED, () => { try { applyBar(); } catch (_) {} });
        eventSource.on(event_types.MESSAGE_SENT, () => { try { applyBar(); } catch (_) {} });
    } catch (e) { console.error('[plot-pilot] event hook failed', e); }

    // 只在按钮缺失时补注入；节流，避免 ST 重绘时反复插入
    try {
        const target = document.getElementById('send_form') ? document.getElementById('send_form').parentElement : document.body;
        if (target) {
            new MutationObserver(() => {
                if (injectTimer) return;
                injectTimer = setTimeout(() => {
                    injectTimer = null;
                    if (!document.getElementById('plot-pilot-bar')) applyBar();
                }, (settings() && settings().pollMs) || 400);
            }).observe(target, { childList: true, subtree: false });
        }
    } catch (_) {}

    window.PlotPilot = {
        version: VERSION,
        get cfg() { return sanitizeConfig(settings()); },
        get detection() { return lastDet; },
        get standby() { return standby; },
        setConfig(patch) {
            const merged = sanitizeConfig(Object.assign({}, settings(), patch || {}));
            extension_settings[NAME] = merged;
            saveSettingsDebounced();
            buildSettingsUi();
            syncPanelInputs();
            refresh();
            return merged;
        },
        recheck() { const r = refresh(); log('api-recheck', formatDetection(r.det)); return r; },
        detect() { return detect(); },
        continue() { const eff = resolveCard(settings(), cardName()); return send(eff.continueText, 'api-continue'); },
        advance() { const eff = resolveCard(settings(), cardName()); const det = detect(); return send(advancePayload(eff, det), 'api-advance'); },
        sendText(text, kind) { return send(text, kind || 'api-send'); },
        cardName() { return cardName(); },
    };

    console.log('[plot-pilot] 已加载 v' + VERSION + '（' + formatDetection(lastDet) + '）');
})();

/** 重画面板里所有输入控件的值（供 setConfig / 外部脚本改配置后同步界面） */
function syncPanelInputs() {
    const s = settings();
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    setChk('pp-enabled', s.enabled); setChk('pp-bar', s.showBar);
    setChk('pp-advance-unknown', s.showAdvanceWhenUnknown); setChk('pp-ignore-legacy', s.ignoreLegacy);
    setVal('pp-continue-label', s.continueLabel); setVal('pp-advance-label', s.advanceLabel);
    setVal('pp-continue-text', s.continueText); setVal('pp-advance-text', s.advanceText);
    setVal('pp-advance-fallback', s.advanceTextFallback); setVal('pp-send-mode', s.sendMode);
    const guard = document.getElementById('pp-guard');
    if (guard) guard.value = String(s.clickGuardMs);
    syncCardFields();
    renderState();
}
