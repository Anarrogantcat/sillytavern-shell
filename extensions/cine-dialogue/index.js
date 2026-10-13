// 作者：小肥鱼 (DeepSeek) · 染喵 ｜ 许可：AGPL-3.0 ｜ 项目：https://github.com/Anarrogantcat/sillytavern-shell
// index.js — 分镜对话 Cine Dialogue · 挂载层
//
/**
 * 分镜对话 · 挂载层
 *
 * 职责：
 *   1) 挂事件（6 个触发点）→ 调度渲染
 *   2) 从 chat[mesid].mes 取**原文** → 交给 logic.js
 *   3) 只替换「100% 是我们的行」的 DOM 块；其余节点（前端 iframe、思考块、状态栏）**一个字节不碰**
 *   4) 整条消息统一名字列宽 + 给换行段落加首行缩进
 *   5) 适配酒馆助手（TavernHelper）/ MVU（只在探测到时装，缺了自动降级）
 *
 * 路径说明：本文件被服务在 /scripts/extensions/third-party/cine-dialogue/
 *   所以到 ST 核心是 4 级 ../（内置扩展是 3 级）
 */

import {
    eventSource,
    event_types,
    extension_settings,
    saveSettingsDebounced,
} from '../../../../script.js';

import { getContext } from '../../../extensions.js';

import {
    EXT_ID,
    VERSION,
    DEFAULT_CONFIG,
    assignColors,
    esc,
    hasOurLines,
    isOurLine,
    renderMessage,
    renderOptions,
    splitSections,
} from './logic.js';

// ---------------------------------------------------------------- 配置

function cfg() {
    if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = {};
    const s = extension_settings[EXT_ID];
    for (const k of Object.keys(DEFAULT_CONFIG)) {
        if (s[k] === undefined) s[k] = DEFAULT_CONFIG[k];
    }
    return s;
}

/** 每个聊天一份颜色表（角色在不同消息里保持同色） */
const colorMap = Object.create(null);

// ---------------------------------------------------------------- 适配层（探测 + 降级）

function TH() {
    return (typeof window !== 'undefined' && window.TavernHelper) ? window.TavernHelper : null;
}

function MVU() {
    return (typeof window !== 'undefined' && window.Mvu) ? window.Mvu : null;
}

/** 卡兼容助手（卡兼容 0.33.0 起暴露 window.CardCompat）—— 只读它的公开 API，不改它 */
function CC() {
    return (typeof window !== 'undefined' && window.CardCompat) ? window.CardCompat : null;
}

/** 剧情推进器（plot-pilot 0.2.x 暴露 window.PlotPilot）—— 复用它的发送通道 */
function PP() {
    return (typeof window !== 'undefined' && window.PlotPilot) ? window.PlotPilot : null;
}

/**
 * 选项按钮 → 发送
 * 优先走 plot-pilot 的 sendText（它有防连点 800ms + api/dom 双通道 + 生成中拦截），
 * 没有它就直接填 #send_textarea（两条路都不自己实现发送）。
 */
function wireOptions(root) {
    root.querySelectorAll('.cd-opt').forEach(btn => {
        if (btn.dataset.cdBound) return;
        btn.dataset.cdBound = '1';
        btn.addEventListener('click', () => {
            const text = (btn.getAttribute('data-cd-text') || '').trim();
            if (!text) return;

            const pp = PP();
            if (pp && typeof pp.sendText === 'function') {
                try { pp.sendText(text); return; } catch (e) { console.error('[' + EXT_ID + '] PlotPilot.sendText failed', e); }
            }
            const ta = document.querySelector('#send_textarea');
            if (ta) {
                ta.value = ta.value ? (ta.value + '\n' + text) : text;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    });
}

/** 取原文：优先走酒馆助手 API，没有就退回 ST 原生 */
function getRawMes(mesId) {
    const th = TH();
    if (th && typeof th.getChatMessages === 'function') {
        try {
            const m = th.getChatMessages(mesId);
            if (m && m[0] && typeof m[0].message === 'string') return m[0].message;
        } catch (_) { /* 降级 */ }
    }
    try {
        const ctx = getContext();
        const m = ctx.chat && ctx.chat[mesId];
        return m ? m.mes : null;
    } catch (_) {
        return null;
    }
}

/** 让 ST 重渲染这一楼（我们会再被 CHARACTER_MESSAGE_RENDERED 叫回来，但要防抖） */
function refreshOne(mesId) {
    const th = TH();
    if (th && typeof th.refreshOneMessage === 'function') {
        try { th.refreshOneMessage(mesId); return; } catch (_) { /* 降级 */ }
    }
}

/** 亮/暗主题 → 由我们自己在 .cd-root 上加类（不能选全局选择器） */
function isLightTheme() {
    try {
        const el = document.documentElement;
        const t = el.getAttribute('data-theme') || el.className || '';
        return String(t).toLowerCase().includes('light');
    } catch (_) {
        return false;
    }
}

// ---------------------------------------------------------------- DOM 工具

/** 节点文本：<br> 视为换行 */
function nodeText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return (clone.textContent || '');
}

/** 这个节点是不是「100% 由我们的分镜行组成」 */
function isOursNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.classList && node.classList.contains('cd-root')) return true; // 我们上次的输出 → 重建

    const lines = nodeText(node).split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return false;                       // 空节点 / 纯 iframe → 别人的
    return lines.every(isOurLine);
}

/** 这个节点里有「我们的行」吗（哪怕混了别的内容） */
function containsOurLine(node) {
    if (!node || node.nodeType !== 1) return false;
    return nodeText(node).split('\n').map(s => s.trim()).filter(Boolean).some(isOurLine);
}

/** 定向刷新一楼 —— 给「会重渲染消息」的兄弟扩展（card-compat / plot-pilot）调 */
function refreshAt(mesId) {
    try {
        const id = Number(mesId);
        if (!Number.isFinite(id) || id < 0) return false;
        const mesEl = document.querySelector('#chat .mes[mesid="' + id + '"]');
        if (!mesEl) return false;
        const r = transformMessage(mesEl, id);
        if (r.ok) { unifyNameColumn(mesEl); applyIndent(mesEl); }
        return r.ok;
    } catch (e) {
        console.error('[' + EXT_ID + '] refreshAt failed', e);
        return false;
    }
}

function htmlToElement(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

// ---------------------------------------------------------------- 渲染

/** 把 .mes_text 里「是我们的」块换成网格；其余原样保留 */
function transformMessage(mesEl, mesId) {
    const c = cfg();
    if (!c.enabled) return { ok: false, reason: 'disabled' };

    const isUser = mesEl.getAttribute('is_user') === 'true';
    if (isUser && !c.transformUserMessages) return { ok: false, reason: 'user-message' };

    const textEl = mesEl.querySelector('.mes_text');
    if (!textEl) return { ok: false, reason: 'no-mes-text' };

    const raw = getRawMes(mesId);
    if (raw == null) return { ok: false, reason: 'no-raw' };
    if (!hasOurLines(raw)) return { ok: false, reason: 'no-our-lines' };

    const sections = splitSections(raw);
    const res = renderMessage(sections.body, colorMap[mesId] = (colorMap[mesId] || {}), c);
    if (!res.html) return { ok: false, reason: 'empty' };

    // 颜色表回写（同角色同色，跨消息保持）
    colorMap[mesId] = res.colors;

    // 1) 摘掉我们的旧输出 + 收集要保留的节点
    const keep = [];
    for (const child of Array.from(textEl.childNodes)) {
        if (child.nodeType === 1 && isOursNode(child)) continue;   // 丢掉，稍后重建
        keep.push(child);
    }

    // 2) 插新网格
    const root = htmlToElement(res.html);
    root.setAttribute('data-cd-version', VERSION);
    if (isLightTheme()) root.classList.add('cd-light');

    const grid = root.querySelector('.cd-grid');
    if (grid) {
        // 选项按钮挂在网格后面（不进网格，避免影响列宽）
    }
    if (sections.options && sections.options.length) {
        root.appendChild(htmlToElement(renderOptions(sections.options, c)));
    }

    // 3) 保留的节点原样接在后面（前端 iframe / 思考块 / 状态栏 —— 一个字节没动）
    for (const n of keep) root.appendChild(n);

    textEl.replaceChildren(root);

    wireOptions(root);

    return { ok: true, root, names: res.names, errs: res.errs };
}

/** 同一楼里可能有多个我们的块；把名字列宽统一成整楼最大 */
function unifyNameColumn(mesEl) {
    const roots = mesEl.querySelectorAll('.cd-root');
    if (roots.length < 2) return;                      // 只有一个块时 max-content 已经够

    let max = 0;
    roots.forEach(r => {
        r.querySelectorAll('.cd-who').forEach(w => {
            const t = (w.textContent || '').trim();
            if (!t) return;
            const wd = w.getBoundingClientRect().width;
            if (wd > max) max = wd;
        });
    });
    if (!max) return;

    roots.forEach(r => {
        r.classList.add('cd-fixed');
        r.style.setProperty('--cd-namew', Math.ceil(max + 2) + 'px');
    });
}

/** 首行缩进：只给「真的换行」的段落；台词永不缩进 */
function applyIndent(mesEl) {
    const c = cfg();
    mesEl.querySelectorAll('.cd-body').forEach(b => {
        b.classList.remove('cd-wrap');
        const row = b.parentElement;
        if (!row || row.classList.contains('cd-L-speech')) return;   // 台词不缩进
        if (!c.indentOnlyWrapped) { b.classList.add('cd-wrap'); return; }
        const lh = parseFloat(getComputedStyle(b).lineHeight);
        if (!lh) return;
        if (b.getBoundingClientRect().height > lh * 1.5) b.classList.add('cd-wrap');
    });
}

// ---------------------------------------------------------------- 调度

let pending = null;
let pendingAll = false;

function schedule(scope) {
    if (scope === 'all') pendingAll = true;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
        pending = null;
        const all = pendingAll;
        pendingAll = false;
        run(all);
    }, 60);
}

function run(all) {
    const list = all
        ? Array.from(document.querySelectorAll('#chat .mes'))
        : Array.from(document.querySelectorAll('#chat .mes')).slice(-3);   // 只处理最近三楼

    for (const mesEl of list) {
        const mesId = Number(mesEl.getAttribute('mesid'));
        if (!Number.isFinite(mesId) || mesId < 0) continue;
        try {
            const r = transformMessage(mesEl, mesId);
            if (r.ok) {
                unifyNameColumn(mesEl);
                applyIndent(mesEl);
            }
        } catch (e) {
            console.error('[' + EXT_ID + '] transform failed, mes=' + mesId, e);
        }
    }
}

// ---------------------------------------------------------------- 事件（6 个触发点）

function bind() {
    const safe = (fn) => () => { try { fn(); } catch (e) { console.error('[' + EXT_ID + ']', e); } };

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, safe(() => schedule(false)));
    eventSource.on(event_types.USER_MESSAGE_RENDERED, safe(() => schedule(false)));

    /* 流式收尾 —— 生成结束后补跑。
       主通道是「兄弟扩展主动通知」：card-compat 的 nudgeRender() / plot-pilot 的动作之后
       会调 window.CineDialogue.refreshAt(id)（见 exposeApi 的互通约定）。
       这里保留两次兜底，只为覆盖：老版本 card-compat、其它会重渲染的扩展、以及
       updateMessageBlock 之后 DOM 尚未落位的情况。 */
    eventSource.on(event_types.GENERATION_ENDED, safe(() => {
        schedule(false);
        for (const d of [200, 8200]) setTimeout(() => schedule(false), d);
    }));

    eventSource.on(event_types.MESSAGE_UPDATED, safe(() => schedule(false)));
    eventSource.on(event_types.MESSAGE_EDITED, safe(() => schedule(false)));
    eventSource.on(event_types.MESSAGE_SWIPED, safe(() => schedule(false)));
    eventSource.on(event_types.CHAT_CHANGED, safe(() => schedule(true)));
    eventSource.on(event_types.MORE_MESSAGES_LOADED, safe(() => schedule(true)));
}

// ---------------------------------------------------------------- 对外 API（阶段 7 扩全，先把地基留好）

function exposeApi() {
    window.CineDialogue = {
        version: VERSION,
        get config() { return { ...cfg() }; },
        setConfig(patch) {
            Object.assign(cfg(), patch || {});
            saveSettingsDebounced();
            schedule(true);
        },
        get colors() { return colorMap; },
        refreshAll: () => schedule(true),

        /**
         * ★ 互通约定（本仓库三个扩展同属一家）：
         *   任何扩展在**重渲染消息**之后，调一句 `window.CineDialogue?.refreshAt?.(messageId)`
         *   —— 因为 ST 的 updateMessageBlock(id, m, {rerenderMessage:true}) 会重建 .mes_text，
         *      把我们已经写好的分镜 DOM 冲掉，而且它**全程不发任何事件**。
         *
         *   已按此约定接入：
         *     · card-compat  → nudgeRender() 里（不受 nudgeRender/compatMode 开关影响）
         *     · plot-pilot   → 发送/推进动作之后
         */
        refreshAt: (mesId) => refreshAt(mesId),
        /**
         * 给别的扩展/卡脚本用：把一段文本渲染成分镜 HTML（纯函数，不碰 DOM）
         */
        render(text, colors) {
            const s = splitSections(text);
            return renderMessage(s.body, colors || {}, cfg());
        },
        stats() {
            const cc = CC();
            const pp = PP();
            return {
                version: VERSION,
                loadedAt: new Date().toISOString(),
                runs: runs++,
                tavernHelper: !!TH(),
                mvu: !!MVU(),
                cardCompat: cc ? (function () {
                    try {
                        return {
                            version: cc.version,
                            protocol: typeof cc.protocol === 'function' ? cc.protocol() : null,
                            compatMode: typeof cc.compatMode === 'function' ? cc.compatMode() : null,
                            mvu: typeof cc.mvu === 'function' ? cc.mvu() : null,
                        };
                    } catch (_) { return { version: cc.version, error: true }; }
                })() : null,
                plotPilot: pp ? (function () {
                    try {
                        const d = (typeof pp.detection !== 'undefined') ? pp.detection : null;
                        return {
                            version: pp.cfg && pp.cfg.version ? pp.cfg.version : null,
                            has: d ? d.has : null,
                            confidence: d ? d.confidence : null,
                            varName: d ? d.varName : null,
                        };
                    } catch (_) { return { error: true }; }
                })() : null,
                light: isLightTheme(),
            };
        },
    };
}

let runs = 0;

// ---------------------------------------------------------------- 启动

function start() {
    cfg();
    bind();
    exposeApi();
    console.log('[' + EXT_ID + '] v' + VERSION + ' loaded'
        + '  TavernHelper=' + (TH() ? 'yes' : 'no')
        + '  Mvu=' + (MVU() ? 'yes' : 'no'));
    schedule(true);
}

// ST 启动时扩展可能早于聊天加载完 → 两个时机都试
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(start, 0);
} else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
}
