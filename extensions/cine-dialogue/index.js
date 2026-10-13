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
    saveSettingsDebounced,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from '../../../../script.js';

/* ★ extension_settings 必须从 extensions.js 拿 —— 它不是 script.js 的导出。
   踩过的坑（0.1.0–0.5.0，真凶）：写成从 script.js import 时，ES module **链接失败**，
   整个模块一行都不执行 → 表现是「管理扩展程序里显示已启用，但抽屉/渲染/设置全都没有」，
   而且 console 之外没有任何提示。所有能正常工作的扩展都从这里拿（card-compat / plot-pilot / hide …）。 */
import { getContext, extension_settings } from '../../../extensions.js';

import {
    EXT_ID,
    VERSION,
    DEFAULT_CONFIG,
    PANEL_FIELDS,
    FORMAT_SPEC,
    REGEX_DEFS,
    SLASH_COMMAND,
    LAYERS,
    MARK_OPTIONS,
    DEFAULT_LAYER_STYLES,
    EXPORT_SCHEMA,
    allLayers,
    assignColors,
    collectNames,
    esc,
    hasOurLines,
    highlightPlan,
    isOurLine,
    layerVars,
    messageTitle,
    parseBlocks,
    parseConfig,
    renderMessage,
    renderMessageHTML,
    renderOptions,
    resolveColors,
    serializeConfig,
    stClassPrefix,
    splitSections,
    validateLayerName,
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
 * 选项按钮 → 发送（**由事件委托调用**，见 bindInteractions）
 *
 * ★ 为什么必须是委托而不是逐个 addEventListener：
 *   钩子路径下 HTML 是 **ST** 插进 DOM 的（addOneMessage / 流式重写 / updateMessageBlock），
 *   我们根本没有"插完之后"的时机去绑事件 —— 原来只在 DOM 降级路径里绑，
 *   结果钩子路径的按钮**全是死的**（真机现象：「点击选项没反应」）。
 *   委托绑在 document 上，无论谁在什么时候插入 HTML 都管用。
 */
function sendOption(text, btn) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return;

    /* 防连点：同一组按钮 1.2 秒内只发一次（plot-pilot 有自己的 800ms，但它可能没装） */
    const now = Date.now();
    if (now - sendOption.last < 1200) {
        notify('刚发过一条，稍等一下', 'warning');
        return;
    }
    sendOption.last = now;

    /* 点了就禁用整组 —— 选项是一次性的，避免重复发送 */
    const group = btn && btn.closest ? btn.closest('.custom-cd-options, .cd-options') : null;
    if (group) {
        group.querySelectorAll('button').forEach(b => {
            b.disabled = true;
            b.style.opacity = '.5';
            b.style.cursor = 'default';
        });
    }

    const pp = PP();
    if (pp && typeof pp.sendText === 'function') {
        try { pp.sendText(t); return; } catch (e) { console.error('[' + EXT_ID + '] PlotPilot.sendText failed', e); }
    }
    const ta = document.querySelector('#send_textarea');
    if (ta) {
        ta.value = ta.value ? (ta.value + '\n' + t) : t;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        notify('已填入输入框（装了剧情推进器会直接发送）', 'info');
    } else {
        notify('找不到输入框，也没装剧情推进器 → 无法发送', 'error');
    }
}
sendOption.last = 0;

/** 复刻 ST 的深度算法（script.js:1828-1830）：**从末尾数，不计 system 楼** */
function depthOf(mesId) {
    try {
        const chat = chatArr();
        const usable = chat.map((m, i) => ({ m, i })).filter(x => !(x.m && x.m.is_system));
        const at = usable.findIndex(x => x.i === Number(mesId));
        return at < 0 ? undefined : (usable.length - at - 1);
    } catch (_) {
        return undefined;
    }
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

/* ---------------------------------------------------------------- 渲染漏斗钩子
   （依赖核内补丁 patches/001-messageFormatting-hook.patch）

   装了补丁时，ST 会在 messageFormatting() 开头调 window.CineDialogueFormat(mes, ctx)——
   那时 markdown / showdown / DOMPurify 都还没跑。

   好处：标签**永不进入 DOM**（流式期间也不裸奔）、没有与 card-compat 的时序竞争、
        编辑 / swipe / 重渲染自动正确。

   没打补丁时：window.__cdMessageFormattingHook 不存在 → 自动走下面的 DOM 后处理路径（降级）。
   两条路共用同一个 logic.js。
   ------------------------------------------------------------------ */

const hookStats = { formatted: 0, lastMid: -1 };

/** 核内补丁接线了没有（补丁里会设这个标记） */
function hookActive() {
    return typeof window !== 'undefined' && window.__cdMessageFormattingHook === true;
}

/** 钩子入口：原文 → HTML 字符串（**不能改 DOM，只能返回字符串**） */
function formatHook(mes, ctx) {
    try {
        const c = effectiveConfig();
        if (!c.enabled) return mes;
        if (ctx && ctx.isSystem) return mes;
        if (ctx && ctx.isUser && !c.transformUserMessages) return mes;
        if (!hasOurLines(mes)) return mes;                        // 没有我们的行 → 一个字不改

        const mid = (ctx && Number.isFinite(Number(ctx.messageId))) ? Number(ctx.messageId) : -1;

        /* 思考块兜底：预设那条思维链正则只覆盖最近 N 层，更早的层由我们折叠。
           depth 算不出来时**选择包**（宁可折叠也不要把思考摊在外面）。 */
        const mode = String(c.thinkingWrap || 'auto');
        const d = depthOf(mid);
        const wrapThinking = (mode === 'always')
            || (mode === 'auto' && (d === undefined || d > (Number(c.thinkingDepth) || 0)));

        const res = renderMessageHTML(mes, colorMap[mid] || {}, c, { wrapThinking });
        if (!res || !res.html) return mes;

        if (mid >= 0) colorMap[mid] = res.colors;                 // 同角色同色，跨消息保持
        hookStats.formatted++;
        hookStats.lastMid = mid;
        return res.html;
    } catch (e) {
        console.error('[' + EXT_ID + '] format hook failed', e);
        return mes;                                               // 出错就原样放行 —— 绝不把消息弄坏
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
    if (node.classList && node.classList.contains('custom-cd-root')) return true; // 我们上次的输出 → 重建

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

        /* 核内钩子已接管：updateMessageBlock 会重走 messageFormatting → 渲染是自动的。
           但「名字列统一 / 首行缩进」要看渲染结果，所以这里仍要补一次装饰。
           （自检发现：原来这里直接 return，导致钩子路径下装饰整片不跑。） */
        if (hookActive()) { decorate(mesEl); return true; }

        const r = transformMessage(mesEl, id);
        if (r.ok) decorate(mesEl);
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
    const c = effectiveConfig();
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
    const root = htmlToElement(stClassPrefix(res.html));
    root.setAttribute('data-cd-version', VERSION);
    if (isLightTheme()) root.classList.add('custom-cd-light');

    const grid = root.querySelector('.custom-cd-grid');
    if (grid) {
        // 选项按钮挂在网格后面（不进网格，避免影响列宽）
    }
    if (sections.options && sections.options.length) {
        root.appendChild(htmlToElement(renderOptions(sections.options, c)));
    }

    // 3) 保留的节点原样接在后面（前端 iframe / 思考块 / 状态栏 —— 一个字节没动）
    for (const n of keep) root.appendChild(n);

    textEl.replaceChildren(root);

    return { ok: true, root, names: res.names, errs: res.errs };
}

/** 同一楼里可能有多个我们的块；把名字列宽统一成整楼最大 */
function unifyNameColumn(mesEl) {
    const roots = mesEl.querySelectorAll('.custom-cd-root');
    if (roots.length < 2) return;                      // 只有一个块时 max-content 已经够

    let max = 0;
    roots.forEach(r => {
        r.querySelectorAll('.custom-cd-who').forEach(w => {
            const t = (w.textContent || '').trim();
            if (!t) return;
            const wd = w.getBoundingClientRect().width;
            if (wd > max) max = wd;
        });
    });
    if (!max) return;

    roots.forEach(r => {
        r.classList.add('custom-cd-fixed');
        r.style.setProperty('--cd-namew', Math.ceil(max + 2) + 'px');
    });
}

/** 首行缩进：只给「真的换行」的段落；台词永不缩进 */
function applyIndent(mesEl) {
    const c = effectiveConfig();
    mesEl.querySelectorAll('.custom-cd-body').forEach(b => {
        b.classList.remove('custom-cd-wrap');
        const row = b.parentElement;
        if (!row || row.classList.contains('custom-cd-L-speech')) return;   // 台词不缩进
        if (!c.indentOnlyWrapped) { b.classList.add('custom-cd-wrap'); return; }
        const lh = parseFloat(getComputedStyle(b).lineHeight);
        if (!lh) return;
        if (b.getBoundingClientRect().height > lh * 1.5) b.classList.add('custom-cd-wrap');
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

/** 装饰层：只做「必须看渲染结果才能做」的两件小事
 *   ① 整楼名字列宽统一（出现多个 .cd-root 时才需要）
 *   ② 首行缩进只给「真的换行」的段落
 *  ★ 这两件**两条路径下都要跑** —— 自检发现：钩子路径曾因 run() 一退到底而整片丢失。 */
function decorate(mesEl) {
    try { unifyNameColumn(mesEl); } catch (_) { /* 装饰失败不影响渲染 */ }
    try { alignPlains(mesEl); } catch (_) { /* 对齐失败不影响渲染 */ }
    try { applyIndent(mesEl); } catch (_) { /* 同上 */ }
}

/**
 * 把「未标注行」对齐到正文列。
 *
 * 这些行必须留在网格**外面**（进网格就没有 markdown 了），于是它们从 x=0 开始，
 * 和正文列（第 2 格，带 3px 边框 + .7em 内边距）对不齐 —— 真机反馈「旁白没和内容对齐」。
 * 做法：靠我们自己埋的**空锚点**定位，只给「锚点之后、下一个锚点/网格之前」的兄弟节点加左内边距。
 * 不去猜哪些节点是"我们的"，也不会碰到卡自己的前端块（那些不在锚点区间里）。
 */
function alignPlains(mesEl) {
    const textEl = mesEl.querySelector('.mes_text');
    if (!textEl) return;
    const anchors = textEl.querySelectorAll('.custom-cd-anchor, .cd-anchor');
    if (!anchors.length) return;

    const root = textEl.querySelector('.custom-cd-root, .cd-root');
    let nameW = 0;
    if (root) {
        root.querySelectorAll('.custom-cd-who, .cd-who').forEach(w => {
            if ((w.textContent || '').trim()) nameW = Math.max(nameW, w.getBoundingClientRect().width);
        });
    }
    let off = 0;
    const body = root ? root.querySelector('.custom-cd-body, .cd-body') : null;
    if (body) {
        const cs = getComputedStyle(body);
        off = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    }
    const pad = Math.max(0, Math.round(nameW + off));

    anchors.forEach(a => {
        for (let n = a.nextSibling; n; n = n.nextSibling) {
            if (n.nodeType === 1) {
                const cls = n.classList;
                if (cls.contains('cd-anchor') || cls.contains('custom-cd-anchor')) break;
                if (cls.contains('cd-root') || cls.contains('custom-cd-root')) break;
                n.style.paddingLeft = pad + 'px';
            } else if (n.nodeType === 3 && String(n.textContent || '').trim()) {
                const span = document.createElement('span');
                span.style.display = 'block';
                span.style.paddingLeft = pad + 'px';
                n.parentNode.insertBefore(span, n);
                span.appendChild(n);
                n = span;
            }
        }
    });
}
function run(all) {
    let list = Array.from(document.querySelectorAll('#chat .mes'));

    if (all) {
        /* 长聊天保护：批量只处理最近 maxRenderFloors 楼（<=0 表示不设上限）。
           注意：装了核内钩子时这条路径本来就不干活（ST 自己按窗口渲染），
           所以这个上限只影响 DOM 降级路径。 */
        const cap = Number(effectiveConfig().maxRenderFloors);
        if (Number.isFinite(cap) && cap > 0 && list.length > cap) list = list.slice(-cap);
    } else {
        list = list.slice(-3);   // 只处理最近三楼
    }

    const hooked = hookActive();
    let rendered = 0;

    for (const mesEl of list) {
        const mesId = Number(mesEl.getAttribute('mesid'));
        if (!Number.isFinite(mesId) || mesId < 0) continue;
        try {
            /* 核内钩子已渲染好了 → 只补装饰，不再解析 DOM
               （钩子的输出里已不含标签，重解析等于白跑，还会把成果再包一层） */
            if (hooked) { decorate(mesEl); continue; }

            const r = transformMessage(mesEl, mesId);
            if (r.ok) { decorate(mesEl); rendered++; }
        } catch (e) {
            console.error('[' + EXT_ID + '] render failed, mes=' + mesId, e);
        }
    }

    try { applyHighlight(); } catch (e) { console.error('[' + EXT_ID + '] highlight failed', e); }

    /* L8：对外广播（别的扩展可用 eventSource.on('cine:rendered', fn) 接） */
    try { eventSource.emit('cine:rendered', { rendered, hooked, total: list.length, at: Date.now() }); } catch (_) { /* 广播失败不影响渲染 */ }
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
    eventSource.on(event_types.CHAT_CHANGED, safe(() => { applyPromptInjection(); schedule(true); }));
    eventSource.on(event_types.MORE_MESSAGES_LOADED, safe(() => schedule(true)));
}

// ---------------------------------------------------------------- 对外 API（阶段 7 扩全，先把地基留好）

function exposeApi() {
    /* ★ 核内补丁 #001 的挂钩点 —— messageFormatting() 开头会调它（没打补丁时无人调用，无副作用） */
    window.CineDialogueFormat = formatHook;

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

        /* ---- L8 生态：给别的扩展 / 卡内嵌脚本用 ---- */

        /** 只解析不渲染：返回 { groups, errs } */
        detect(text) {
            return parseBlocks(splitSections(text).body, allLayers(effectiveConfig()));
        },

        /** 样式有没有生效 —— 一次性问清（不用开 DevTools 逐层看） */
        diagnose: () => diagnose(),

        /** 手动重注入样式（改了 style.css 之后不用刷页面） */
        reloadStyles() {
            const old = document.getElementById('cd-style');
            if (old) old.remove();
            cssState.injected = false;
            return injectStyles();
        },

        /** 注册一个自定义层（别的扩展也能调） */
        registerLayer(layer) {
            const v = validateLayerName(layer && (layer.name || layer), allLayers(cfg()));
            if (!v.ok) return v;
            const c = cfg();
            c.customLayers = (c.customLayers || []).filter(l => l.name !== v.name)
                .concat([{ name: v.name, mark: (layer && layer.mark) || 'dashed', italic: !!(layer && layer.italic) }]);
            saveSettingsDebounced(); rebuildDynamic(); schedule(true);
            return { ok: true, name: v.name };
        },

        /** 格式错误清单（按需扫描，不维护状态） */
        errors: (limit) => scanFormatErrors(limit || 30),

        /** 导出全部分镜 Markdown（只返回字符串，不下载） */
        exportStory: () => buildStoryMarkdown(),

        /** 当前生效配置（含逐卡覆盖） */
        get effectiveConfig() { return { ...effectiveConfig() }; },

        /** 当前卡的身份键 */
        cardKey: () => cardKey(),

        /** MVU 只读快照 —— **绝不写**（写数据是 card-compat 的职责，见 AGENTS §0.3.1） */
        mvu() {
            const m = MVU();
            if (!m || typeof m.getMvuData !== 'function') return null;
            try {
                return m.getMvuData({ type: 'message', message_id: Math.max(0, chatArr().length - 1) });
            } catch (e) {
                console.warn('[' + EXT_ID + '] 读 MVU 失败（只读探测，不影响渲染）', e);
                return null;
            }
        },

        /**
         * 给别的扩展/卡脚本用：把一段文本渲染成分镜 HTML（纯函数，不碰 DOM）
         */
        render(text, colors) {
            const s = splitSections(text);
            return renderMessage(s.body, colors || {}, effectiveConfig());
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
                /** 核内补丁 #001 接线状态 + 它处理了多少条 */
                hook: { active: hookActive(), formatted: hookStats.formatted, lastMid: hookStats.lastMid },
            };
        },
    };
}

let runs = 0;

// ---------------------------------------------------------------- L3 提示词注入

const PROMPT_KEY = 'CINE_DIALOGUE_FORMAT';

/**
 * 把格式说明注入提示词。
 * ★ 默认关：专属预设 `Izumi 0828.tailfree + 分镜` 里已有同样说明，两边同时开会重复占提示词。
 *   换回原版预设时打开它 —— 这样插件**不再依赖任何一个预设**。
 */
function applyPromptInjection() {
    try {
        const c = cfg();
        const use = !!c.injectPrompt;
        const pos = Number(c.promptPosition) === 1
            ? extension_prompt_types.IN_CHAT
            : extension_prompt_types.IN_PROMPT;
        const depth = Math.max(0, Number(c.promptDepth) || 0);
        setExtensionPrompt(PROMPT_KEY, use ? FORMAT_SPEC : '', pos, depth, false, extension_prompt_roles.SYSTEM);
        console.log('[' + EXT_ID + '] 提示词注入：' + (use ? '开（深度 ' + depth + '）' : '关（靠预设自带的说明）'));
    } catch (e) {
        console.error('[' + EXT_ID + '] 注入格式说明失败', e);
    }
}

// ---------------------------------------------------------------- 专属正则（4 条）

function regexAvailable() {
    const th = TH();
    return !!(th && typeof th.updateTavernRegexesWith === 'function');
}

/** REGEX_DEFS（纯数据）→ 酒馆助手归一化的 TavernRegex 形状 */
function buildRegexes() {
    return REGEX_DEFS.map(d => ({
        id: d.id,
        script_name: d.script_name,
        enabled: !!d.enabled,
        find_regex: d.find_regex,
        replace_string: d.replace_string,
        trim_strings: [],
        source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
        destination: { display: true, prompt: false },
        run_on_edit: d.run_on_edit !== false,
        min_depth: d.min_depth === undefined ? null : d.min_depth,
        max_depth: d.max_depth === undefined ? null : d.max_depth,
    }));
}

/**
 * 安装/更新 4 条专属正则。
 * ★ 必须**一次写完** —— `updateTavernRegexesWith` 会重载整个聊天，分多次写会卡好几轮。
 * ★ 只写 `destination.display` + `max_depth:3`：不动提示词，只作用最近 3 楼。
 */
async function installRegexes(silent) {
    if (!regexAvailable()) {
        notify('需要酒馆助手（TavernHelper）才能注册专属正则', 'warning');
        return false;
    }
    try {
        const want = buildRegexes();
        const mine = new Set(want.map(r => r.script_name));
        await TH().updateTavernRegexesWith(list =>
            (Array.isArray(list) ? list : [])
                .filter(r => !mine.has(r && r.script_name) && !String((r && r.id) || '').startsWith('cd-r'))
                .concat(want)
        , { type: 'global' });
        if (!silent) notify('【分镜】专属正则已安装/更新（4 条，只作用最近 3 楼）', 'success');
        console.log('[' + EXT_ID + '] 专属正则已写入（全局，display-only）');
        return true;
    } catch (e) {
        console.error('[' + EXT_ID + '] 安装专属正则失败', e);
        if (!silent) notify('专属正则安装失败：' + (e && e.message ? e.message : String(e)), 'error');
        return false;
    }
}

/** 卸载我们注册的正则（只删自己的，不碰别人的） */
async function removeRegexes() {
    if (!regexAvailable()) { notify('需要酒馆助手才能改正则', 'warning'); return false; }
    try {
        const mine = new Set(REGEX_DEFS.map(d => d.script_name));
        await TH().updateTavernRegexesWith(list =>
            (Array.isArray(list) ? list : [])
                .filter(r => !mine.has(r && r.script_name) && !String((r && r.id) || '').startsWith('cd-r'))
        , { type: 'global' });
        notify('【分镜】专属正则已移除', 'success');
        return true;
    } catch (e) {
        notify('移除失败：' + (e && e.message ? e.message : String(e)), 'error');
        return false;
    }
}

// ---------------------------------------------------------------- L4 斜杠命令

function notify(msg, type) {
    try {
        if (typeof toastr !== 'undefined') {
            const fn = toastr[type] || toastr.info;
            fn.call(toastr, String(msg));
            return;
        }
    } catch (_) { /* 没有 toastr 就只打控制台 */ }
    console.log('[' + EXT_ID + '] ' + msg);
}

let slashRegistered = false;

/**
 * 注册 /cine（别名 /cd、/storyboard）。
 * 形状照已装扩展 RUBY 的范例：ST 通过 getContext() 暴露 SlashCommandParser / SlashCommand。
 */
function registerSlashCommand() {
    if (slashRegistered) return;
    try {
        const c = getContext();
        if (!c || !c.SlashCommandParser || !c.SlashCommand) {
            console.warn('[' + EXT_ID + '] 斜杠命令 API 不可用 → 跳过注册（不影响渲染）');
            return;
        }
        let unnamed = [];
        try {
            if (c.SlashCommandArgument && c.ARGUMENT_TYPE) {
                unnamed = [c.SlashCommandArgument.fromProps({
                    description: '子命令：' + SLASH_COMMAND.subcommands.map(s => s.name).join(' / '),
                    typeList: [c.ARGUMENT_TYPE.STRING],
                    isRequired: false,
                })];
            }
        } catch (_) { unnamed = []; }

        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
            name: SLASH_COMMAND.name,
            returns: SLASH_COMMAND.returns,
            unnamedArgumentList: unnamed,
            helpString: SLASH_COMMAND.helpString,
            aliases: SLASH_COMMAND.aliases,
            callback: (_args, value) => runSlashCommand(String(value == null ? '' : value).trim().toLowerCase()),
        }));
        slashRegistered = true;
        console.log('[' + EXT_ID + '] 斜杠命令 /' + SLASH_COMMAND.name + ' 已注册（别名：' + SLASH_COMMAND.aliases.join(', ') + '）');
    } catch (e) {
        console.error('[' + EXT_ID + '] 斜杠命令注册失败', e);
    }
}

function runSlashCommand(sub) {
    switch (sub) {
        case '':
        case 'refresh':
            schedule(true);
            return '已触发全量重渲染';
        case 'stats':
            return JSON.stringify(window.CineDialogue ? window.CineDialogue.stats() : {}, null, 2);
        case 'config':
            return JSON.stringify(cfg(), null, 2);
        case 'regex':
            installRegexes(false);
            return '正在安装【分镜】专属正则…（会重载聊天，稍等几秒）';
        default:
            return '未知子命令：' + sub + '（可用：' + SLASH_COMMAND.subcommands.map(s => s.name).join(' / ') + '）';
    }
}

// ---------------------------------------------------------------- L5/L6/L7/L8 工具

function chatArr() {
    try {
        const ctx = getContext();
        return (ctx && Array.isArray(ctx.chat)) ? ctx.chat : [];
    } catch (_) { return []; }
}

/** 当前角色卡的身份键（文件名），用于逐卡配置 */
function cardKey() {
    try {
        const ctx = getContext();
        const c = ctx.characters && ctx.characters[ctx.characterId];
        return (c && c.avatar) ? String(c.avatar) : '';
    } catch (_) { return ''; }
}

/** 当前生效配置 = 全局配置 + 本卡覆盖 */
function effectiveConfig() {
    const base = cfg();
    const key = cardKey();
    if (!key || !base.perCard || !base.perCard[key]) return base;
    return { ...base, ...base.perCard[key] };
}

/* 已见过的角色名（颜色管理用）：来自颜色表 + 各楼正文 */
function knownNames() {
    const set = new Set();
    for (const k of Object.keys(colorMap)) {
        for (const n of Object.keys(colorMap[k] || {})) set.add(n);
    }
    const c = effectiveConfig();
    for (const n of Object.keys(c.charColors || {})) set.add(n);
    for (const mes of chatArr()) {
        const raw = mes && mes.mes;
        if (typeof raw !== 'string' || !hasOurLines(raw, allLayers(c))) continue;
        const sec = splitSections(raw);
        const pb = parseBlocks(sec.body, allLayers(c));
        for (const n of collectNames(pb.groups)) set.add(n);
    }
    return [...set];
}

/** 扫描格式错的行（按需计算，不维护状态 —— 不会和渲染脱节） */
function scanFormatErrors(limit = 30) {
    const c = effectiveConfig();
    const layers = allLayers(c);
    const out = [];
    const chat = chatArr();
    for (let i = 0; i < chat.length && out.length < limit; i++) {
        const raw = chat[i] && chat[i].mes;
        if (typeof raw !== 'string' || !hasOurLines(raw, layers)) continue;
        const pb = parseBlocks(splitSections(raw).body, layers);
        if (!pb.errs) continue;
        for (const g of pb.groups) {
            for (const r of g) {
                if (r.kind === 'err') out.push({ mesId: i, raw: r.raw });
                if (out.length >= limit) break;
            }
            if (out.length >= limit) break;
        }
    }
    return out;
}

/** 浏览器下载（L7：导出走 Blob，不需要服务端、不需要动本体） */
function download(filename, text, mime) {
    try {
        const blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return true;
    } catch (e) {
        notify('下载失败：' + (e && e.message ? e.message : String(e)), 'error');
        return false;
    }
}

/** 复制到剪贴板（含 execCommand 兜底） */
function copyText(text) {
    const s = String(text == null ? '' : text);
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(s).then(() => notify('已复制：' + s.slice(0, 30) + (s.length > 30 ? '…' : ''), 'success'),
                () => fallbackCopy(s));
            return;
        }
    } catch (_) { /* 落到兜底 */ }
    fallbackCopy(s);
}

function fallbackCopy(s) {
    try {
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        notify('已复制', 'success');
    } catch (e) {
        notify('复制失败：' + (e && e.message ? e.message : String(e)), 'error');
    }
}

/** 把整段聊天导出成 Markdown（L7） */
function buildStoryMarkdown() {
    const c = effectiveConfig();
    const layers = allLayers(c);
    const lines = ['# 分镜对话导出', '', '> 由 cine-dialogue v' + VERSION + ' 导出 · ' + new Date().toLocaleString(), ''];
    let n = 0;
    for (const mes of chatArr()) {
        const raw = mes && mes.mes;
        if (typeof raw !== 'string' || !hasOurLines(raw, layers)) continue;
        const title = messageTitle(parseBlocks(splitSections(raw).body, layers).groups);
        lines.push('## #' + (n++) + (title ? ' — ' + title : ''));
        lines.push('');
        const pb = parseBlocks(splitSections(raw).body, layers);
        for (const g of pb.groups) {
            for (const r of g) {
                if (r.kind === 'row') lines.push('**' + r.name + '**〔' + r.layer + '〕' + r.text);
                else if (r.kind === 'narr') lines.push('*旁白* ' + r.body);
                else lines.push('> ⚠ 格式错误：' + r.raw);
            }
            lines.push('');
        }
    }
    return lines.join('\n');
}

/* ---------------------------------------------------------------- L2 交互 */

/** 搜索高亮：DOM 后处理，不重渲染（改一个词不该重算全部楼层） */
function applyHighlight(root) {
    const q = String(effectiveConfig().highlight || '').trim();
    const scope = root || document;
    scope.querySelectorAll('#chat .custom-cd-root').forEach(r => {
        r.querySelectorAll('mark.custom-cd-hit').forEach(m => {
            m.replaceWith(document.createTextNode(m.textContent || ''));
        });
        r.normalize();
        if (!q) return;
        r.querySelectorAll('.custom-cd-who, .custom-cd-body').forEach(el => {
            const parts = highlightPlan(el.textContent || '', q);
            if (!parts.some(p => p.hit)) return;
            el.textContent = '';
            for (const p of parts) {
                if (!p.hit) { el.appendChild(document.createTextNode(p.t)); continue; }
                const m = document.createElement('mark');
                m.className = 'custom-cd-hit';
                m.textContent = p.t;
                el.appendChild(m);
            }
        });
    });
}

/** 跳到上一/下一「有分镜」的楼层（Alt+↑ / Alt+↓） */
function jumpScene(dir) {
    const mesEls = Array.from(document.querySelectorAll('#chat .mes'));
    const withCd = mesEls.filter(m => m.querySelector('.custom-cd-root'));
    if (!withCd.length) return;
    const top = window.innerHeight * 0.35;
    let cur = -1;
    withCd.forEach((m, i) => { if (m.getBoundingClientRect().top <= top) cur = i; });
    const next = Math.min(withCd.length - 1, Math.max(0, cur + (dir > 0 ? 1 : -1)));
    withCd[next].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 逐行复制（双击）+ Alt+↑/↓ 跳场景。事件委托：只绑一次，重建 DOM 也不用重绑 */
let interactionsBound = false;
function bindInteractions() {
    if (interactionsBound) return;
    interactionsBound = true;

    /* 为什么用双击而不是 hover 复制按钮：
       按钮若放进 .cd-body，会污染 textContent —— 复制到的文本、搜索高亮重建的文本都会带上它。
       双击没有这个副作用，且不用往每行塞元素。提示放在 .cd-body 的 title 上。 */
    /* ★ 选项按钮：**委托**处理。
       钩子路径下 HTML 由 ST 插入，我们没有"插完之后"的时机逐个绑事件 ——
       原来只在 DOM 降级路径里绑，导致钩子路径的按钮全是死的（真机：点击没反应）。 */
    document.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('.custom-cd-opt, .cd-opt') : null;
        if (!btn || btn.disabled) return;
        ev.preventDefault();
        ev.stopPropagation();
        sendOption(btn.getAttribute('data-cd-text'), btn);
    }, true);
    document.addEventListener('dblclick', (ev) => {
        if (!effectiveConfig().copyOnClick) return;
        const body = ev.target && ev.target.closest ? ev.target.closest('.custom-cd-body') : null;
        if (!body) return;
        const row = body.closest('.custom-cd-row');
        const who = row ? (row.querySelector('.custom-cd-who') || {}).textContent : '';
        const w = String(who || '').trim();
        copyText((w ? w + '：' : '') + (body.textContent || ''));
    });

    document.addEventListener('keydown', (ev) => {
        if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
        const tag = (ev.target && ev.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) return;
        if (ev.key === 'ArrowUp') { ev.preventDefault(); jumpScene(-1); }
        if (ev.key === 'ArrowDown') { ev.preventDefault(); jumpScene(1); }
    });
}

// ---------------------------------------------------------------- 样式注入（不依赖宿主加载）

/* ★ 为什么自己注入 CSS：
   ST 加载扩展是 `Promise.all([addExtensionScript, addExtensionStyle])` ——
   脚本先跑完（我们的抽屉就是那时画出来的），**link 失败只会在之后 reject**，
   于是表现成「扩展明明加载了，但一点样式都没有」。
   真机踩过：`link` 没生效 → .cd-row{display:contents} 不成立 → 名字和正文挤成一行。

   现在我们自己 fetch `./style.css` 并塞进 <style>；**fetch 失败还有内置兜底**，
   任何情况下都不会「没有样式」。 */

const FALLBACK_CSS = [
    '.custom-cd-root{--cd-sub:#9aa8bf;--cd-mark-w:3px;line-height:1.9;word-break:break-word}',
    '.custom-cd-grid{display:grid;grid-template-columns:max-content 1fr;row-gap:var(--cd-gap,.8em)}',
    '.custom-cd-row{display:contents;color:var(--c,inherit)}',
    '.custom-cd-who{font-weight:600;font-size:.95em;opacity:.85;text-align:right;padding-right:.6em;white-space:nowrap}',
    '.custom-cd-body{min-width:0;border-left:3px var(--cd-mark,solid) var(--cd-mark-color,transparent);',
    'font-style:var(--cd-italic,normal);padding-left:.7em}',
    '.custom-cd-body.custom-cd-wrap{text-indent:var(--cd-indent,2em)}',
    '.custom-cd-L-speech{--cd-mark:solid;--cd-mark-color:transparent;--cd-italic:normal}',
    '.custom-cd-L-act{--cd-mark:solid;--cd-mark-color:currentColor;--cd-italic:normal}',
    '.custom-cd-L-sense{--cd-mark:dotted;--cd-mark-color:currentColor;--cd-italic:normal;opacity:.94}',
    '.custom-cd-L-mind{--cd-mark:double;--cd-mark-color:currentColor;--cd-italic:italic}',
    '.custom-cd-L-narr{--cd-mark:solid;--cd-mark-color:transparent;--cd-italic:normal}',
    '.custom-cd-L-custom{--cd-mark:dashed;--cd-mark-color:currentColor;--cd-italic:normal}',
    '.custom-cd-L-narr .custom-cd-body{color:var(--cd-sub);opacity:.92}',
    '.custom-cd-sep{grid-column:1/-1;height:0;border-top:1px solid var(--cd-sep,rgba(128,140,160,.28));margin:.45em 0}',
    '.custom-cd-line{grid-column:1/-1;min-width:0;color:var(--cd-sub);opacity:.88;white-space:pre-wrap;word-break:break-word}',
    '.custom-cd-row.custom-cd-dim{opacity:.32}',
    '.custom-cd-hit{background:rgba(255,214,0,.30);border-radius:.15em}',
    '.custom-cd-options{display:flex;flex-direction:column;gap:.35em;margin-top:.9em}',
    '.custom-cd-opt{display:flex;align-items:baseline;gap:.7em;width:100%;text-align:left;cursor:pointer;',
    'font:inherit;font-size:.9em;padding:.5em .8em;border-radius:.3em;',
    'border:1px solid rgba(128,140,160,.32);background:rgba(255,255,255,.04);color:inherit}',
].join('');

const cssState = { injected: false, source: 'none', error: '', bytes: 0 };

async function injectStyles() {
    if (document.getElementById('cd-style')) {
        cssState.injected = true;
        return;
    }
    let text = '';
    try {
        const r = await fetch(new URL('./style.css', import.meta.url));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        text = await r.text();
        cssState.source = 'file';
    } catch (e) {
        text = FALLBACK_CSS;
        cssState.source = 'fallback';
        cssState.error = String((e && e.message) ? e.message : e);
        console.warn('[' + EXT_ID + '] style.css 取不到，改用内置兜底样式：', cssState.error);
    }
    const el = document.createElement('style');
    el.id = 'cd-style';
    el.textContent = text;
    document.head.appendChild(el);
    cssState.injected = true;
    cssState.bytes = text.length;
    console.log('[' + EXT_ID + '] 样式已注入（来源 ' + cssState.source + '，' + text.length + ' 字节）');
}

/** 一次性把「样式到底有没有生效」问清 —— 不用开 DevTools 逐层看 */
function diagnose() {
    const q = (s) => document.querySelector('#chat ' + s);
    const grid = q('.custom-cd-grid'), row = q('.custom-cd-row'), body = q('.custom-cd-body');
    const link = document.querySelector('link[id*="cine-dialogue"], link[href*="cine-dialogue"]');
    const g = grid ? getComputedStyle(grid) : null;
    const r = row ? getComputedStyle(row) : null;
    const b = body ? getComputedStyle(body) : null;
    const who = q('.custom-cd-who');
    const w = who ? getComputedStyle(who) : null;
    return {
        version: VERSION,
        css: {
            injected: cssState.injected,
            source: cssState.source,
            bytes: cssState.bytes,
            error: cssState.error,
            hostLinkHref: link ? link.href : '(宿主没插 link)',
            hostLinkLoaded: !!(link && link.sheet),
        },
        grid: g ? { display: g.display, columns: g.gridTemplateColumns } : '(没有 .cd-grid)',
        row: r ? { display: r.display, color: r.color } : '(没有 .cd-row)',
        body: b ? {
            borderLeft: b.borderLeftWidth + ' ' + b.borderLeftStyle + ' ' + b.borderLeftColor,
            fontStyle: b.fontStyle,
        } : '(没有 .cd-body)',
        who: w ? { textAlign: w.textAlign, paddingRight: w.paddingRight } : '(没有 .cd-who)',
        counts: {
            roots: document.querySelectorAll('#chat .custom-cd-root').length,
            rows: document.querySelectorAll('#chat .custom-cd-row').length,
        },
        /* ★ DOM 实况：一次区分三种可能
           ① 我们的类还在（custom-cd-*）→ HTML 到达了 DOM，看样式为何没匹配
           ② 我们的类**不见了**          → 有东西改写了我们的 HTML
           ③ style 计数为 0             → inline style 被剥

           ⚠️ 必须挑「**真的有我们输出**的那一楼」—— 之前只看第一条 .mes_text，
              那条恰好没有我们的内容，于是 classes 是空的、把判断带偏了（我的错）。 */
        domProbe: (function () {
            const all = Array.from(document.querySelectorAll('#chat .mes_text'));
            const target = all.find(t => t.querySelector('.custom-cd-root') || t.querySelector('.cd-root'))
                || all[all.length - 1];
            if (!target) return '(没有 .mes_text)';
            const cls = new Set();
            target.querySelectorAll('*').forEach(el => {
                String(el.className || '').split(/\s+/).forEach(c => { if (c) cls.add(c); });
            });
            return {
                probedWhich: (all.indexOf(target) + 1) + '/' + all.length + ' 条消息',
                hasCdRoot: !!target.querySelector('.custom-cd-root, .cd-root'),
                hasCdGrid: !!target.querySelector('.custom-cd-grid, .cd-grid'),
                hasCdRow: !!target.querySelector('.custom-cd-row, .cd-row'),
                hasCdWho: !!target.querySelector('.custom-cd-who, .cd-who'),
                hasCdBody: !!target.querySelector('.custom-cd-body, .cd-body'),
                hasCdOptions: !!target.querySelector('.custom-cd-options, .cd-options'),
                hasCdOpt: !!target.querySelector('.custom-cd-opt, .cd-opt'),
                inlineStyleAttrs: (target.innerHTML.match(/style="/g) || []).length,
                classes: [...cls].slice(0, 40),
            };
        })(),

        /* 选项按钮实况 —— 白盒子的最后一道判断 */
        optProbe: (function () {
            const b = document.querySelector('#chat .custom-cd-opt, #chat .cd-opt, #chat .mes_text button');
            if (!b) return '(聊天里没有 button)';
            const cs = getComputedStyle(b);
            return {
                className: b.className,
                hasInlineStyle: !!b.getAttribute('style'),
                background: cs.backgroundColor,
                color: cs.color,
                border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
                padding: cs.padding,
                text: String(b.textContent || '').slice(0, 24),
            };
        })(),
        hook: hookActive(),
    };
}

// ---------------------------------------------------------------- 设置面板

/* 为什么必须有这个抽屉：
   ST 的「扩展程序」总览**不是**"已加载扩展清单" —— 它是各扩展**自己**往
   #extensions_settings / #extensions_settings2 里 append 的 inline-drawer。
   实测对照：card-compat（3 处）、plot-pilot（3 处）、hide（6 处）都有 append，
   所以它们出现在总览里；本扩展 0.2.1 之前一处都没有 → 只在「管理扩展程序」
   页可见、总览里看不到。没有抽屉 ≠ 没加载。

   ★ 抽屉骨架用 ST 自带的 inline-drawer / menu_button 类（那是 ST 的样式），
     我们**只给 #cd-panel 里的自有元素写样式** —— 不覆写 .inline-drawer，
     否则会漏进别的扩展的设置面板（AGENTS §0.3.2）。 */

function fieldHTML(f, c) {
    const key = esc(f.key);
    const lab = '<span class="cd-lab">' + esc(f.label) + '</span>';
    const note = f.note ? '<span class="cd-note">' + esc(f.note) + '</span>' : '';

    if (f.kind === 'bool') {
        return '<label class="cd-line cd-line-bool">'
            + '<input type="checkbox" data-cd-key="' + key + '"' + (c[f.key] ? ' checked' : '') + '>'
            + lab + note + '</label>';
    }
    if (f.kind === 'select') {
        const opts = (f.options || []).map(o =>
            '<option value="' + esc(o[0]) + '"' + (String(c[f.key]) === String(o[0]) ? ' selected' : '') + '>'
            + esc(o[1]) + '</option>').join('');
        return '<div class="cd-line">' + lab + '<select data-cd-key="' + key + '">' + opts + '</select>' + note + '</div>';
    }
    if (f.kind === 'text') {
        return '<div class="cd-line">' + lab
            + '<input type="text" data-cd-key="' + key + '" value="' + esc(c[f.key]) + '">'
            + note + '</div>';
    }
    const unit = f.unit ? ' ' + f.unit : '';
    const when = f.when ? '（' + esc(f.when) + ' 时生效）' : '';
    return '<div class="cd-line">' + lab
        + '<input type="number" data-cd-key="' + key + '" value="' + esc(c[f.key]) + '"'
        + ' min="' + esc(f.min) + '" max="' + esc(f.max) + '" step="' + esc(f.step) + '">'
        + '<span class="cd-note">' + esc(unit) + esc(when) + '</span></div>';
}

const MARK_LABEL = { none: '无标记', solid: '实线', dotted: '点线', double: '双线', dashed: '虚线' };

/** 重建面板里的动态区块：配色 / 层样式 / 自定义层 / 角色下拉 / 本卡状态 */
function rebuildDynamic() {
    const c = cfg();
    const names = knownNames();

    /* 配色：见过的角色 → 取色器。改一下就**钉死**（写进 charColors），
       重置按钮清空后又回到「按出现顺序分配」。 */
    const colorsBox = document.getElementById('cd-colors');
    if (colorsBox) {
        if (!names.length) {
            colorsBox.innerHTML = '<div class="cd-note">还没有见过的角色名 —— 先生成一楼再回来。</div>';
        } else {
            const cm = {};
            for (const k of Object.keys(colorMap)) Object.assign(cm, colorMap[k] || {});
            colorsBox.innerHTML = names.map(n => {
                const fixed = (c.charColors && c.charColors[n]) || '';
                const val = fixed || resolveColors([n], c, cm)[n];
                return '<div class="cd-line"><span class="cd-lab">' + esc(n) + '</span>'
                    + '<input type="color" data-cd-color="' + esc(n) + '" value="' + esc(val) + '">'
                    + (fixed ? '<span class="cd-note">已钉死</span>' : '<span class="cd-note">自动</span>')
                    + '</div>';
            }).join('');
        }
    }

    /* 层样式：内置 + 自定义层，逐层选左侧标记 + 斜体 */
    const layersBox = document.getElementById('cd-layers');
    if (layersBox) {
        layersBox.innerHTML = allLayers(c).map(l => {
            const st = { ...(DEFAULT_LAYER_STYLES[l] || DEFAULT_LAYER_STYLES['旁白']), ...((c.layerStyles || {})[l] || {}) };
            const opts = MARK_OPTIONS.map(m =>
                '<option value="' + m + '"' + (st.mark === m ? ' selected' : '') + '>' + (MARK_LABEL[m] || m) + '</option>').join('');
            return '<div class="cd-line"><span class="cd-lab">' + esc(l) + '</span>'
                + '<select data-cd-layermark="' + esc(l) + '">' + opts + '</select>'
                + '<label class="cd-line-bool"><input type="checkbox" data-cd-layeritalic="' + esc(l) + '"' + (st.italic ? ' checked' : '') + '>'
                + '<span class="cd-note">斜体</span></label></div>';
        }).join('');
    }

    /* 自定义层清单 */
    const clBox = document.getElementById('cd-customlayers');
    if (clBox) {
        const list = Array.isArray(c.customLayers) ? c.customLayers : [];
        clBox.innerHTML = list.length
            ? list.map(l => '<div class="cd-line"><span class="cd-lab">' + esc(l.name) + '</span>'
                + '<span class="cd-note">' + esc(MARK_LABEL[l.mark] || l.mark || '虚线') + (l.italic ? ' · 斜体' : '') + '</span>'
                + '<button type="button" class="menu_button" data-cd-dellayer="' + esc(l.name) + '">删除</button></div>').join('')
            : '<div class="cd-note">内置五层：' + LAYERS.join(' / ') + '　（自定义层加进来后，模型就能用「名字·新层 内容」）</div>';
    }

    /* 只看某角色 */
    const sel = document.getElementById('cd-onlychar');
    if (sel) {
        const cur = String(c.onlyChar || '');
        sel.innerHTML = '<option value="">全部角色</option>'
            + names.map(n => '<option value="' + esc(n) + '"' + (cur === n ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
    }

    /* 本卡配置状态 */
    const stEl = document.getElementById('cd-cardstate');
    if (stEl) {
        const k = cardKey();
        const has = !!(k && c.perCard && c.perCard[k]);
        stEl.textContent = k
            ? ('当前卡：' + k + (has ? ' —— 已有专属配置（覆盖全局）' : ' —— 没有专属配置，用全局设置'))
            : '没有加载角色卡 → 逐卡配置不可用';
    }
}

/** 格式错误列表（点按钮才算，不维护状态） */
function refreshErrorList() {
    const box = document.getElementById('cd-errlist');
    if (!box) return;
    const errs = scanFormatErrors(30);
    if (!errs.length) { box.innerHTML = '<div class="cd-note">没有格式错误 ✓</div>'; return; }
    box.innerHTML = errs.map(e =>
        '<div class="cd-errrow"><button type="button" class="menu_button" data-cd-jump="' + e.mesId + '">#' + e.mesId + '</button>'
        + '<span class="cd-errtext">' + esc(String(e.raw).slice(0, 80)) + '</span></div>').join('');
}

function wirePanel() {
    const panel = document.getElementById('cd-panel');
    if (!panel) return;

    panel.querySelectorAll('[data-cd-key]').forEach(el => {
        el.addEventListener('change', () => {
            const key = el.getAttribute('data-cd-key');
            if (!key || !(key in DEFAULT_CONFIG)) return;
            const def = DEFAULT_CONFIG[key];
            const type = el.getAttribute('type');
            /* 数值型的 select（如注入位置）必须转成数字 —— 否则存进去是字符串，
               parseConfig 的类型校验会把它当脏数据丢掉 */
            const v = (type === 'checkbox') ? el.checked
                : (el.tagName === 'SELECT' || type === 'text' || type === 'color')
                    ? (typeof def === 'number' ? Number(el.value) : el.value)
                    : Number(el.value);
            cfg()[key] = v;
            saveSettingsDebounced();

            // 提示词相关开关：改完立刻重新注入（不用等下一次生成）
            if (key === 'injectPrompt' || key === 'promptDepth' || key === 'promptPosition') {
                applyPromptInjection();
            }
            schedule(true);                       // 改完立即全量重渲染
        });
    });

    const refresh = panel.querySelector('#cd-refresh-all');
    if (refresh) refresh.addEventListener('click', () => schedule(true));

    const regIn = panel.querySelector('#cd-regex-install');
    if (regIn) regIn.addEventListener('click', () => installRegexes(false));

    const regRm = panel.querySelector('#cd-regex-remove');
    if (regRm) regRm.addEventListener('click', () => removeRegexes());

    const diag = panel.querySelector('#cd-diag');
    if (diag) {
        diag.addEventListener('click', () => {
            const pre = document.getElementById('cd-hb');
            if (!pre) return;
            try {
                pre.textContent = JSON.stringify(diagnose(), null, 2);
            } catch (e) {
                pre.textContent = '诊断失败：' + (e && e.message ? e.message : String(e));
            }
        });
    }

    /* 动态区块的 change：配色取色器 / 层标记 / 层斜体 */
    panel.addEventListener('change', (ev) => {
        const t = ev.target;
        if (!t || !t.getAttribute) return;

        const colorName = t.getAttribute('data-cd-color');
        if (colorName) {
            cfg().charColors = { ...(cfg().charColors || {}), [colorName]: t.value };
            saveSettingsDebounced(); rebuildDynamic(); schedule(true);
            return;
        }
        const markLayer = t.getAttribute('data-cd-layermark');
        if (markLayer) {
            const ls = { ...(cfg().layerStyles || {}) };
            ls[markLayer] = { ...(ls[markLayer] || {}), mark: t.value };
            cfg().layerStyles = ls;
            saveSettingsDebounced(); schedule(true);
            return;
        }
        const italLayer = t.getAttribute('data-cd-layeritalic');
        if (italLayer) {
            const ls = { ...(cfg().layerStyles || {}) };
            ls[italLayer] = { ...(ls[italLayer] || {}), italic: !!t.checked };
            cfg().layerStyles = ls;
            saveSettingsDebounced(); schedule(true);
        }
    });

    /* 动态区块的 click：删除层 / 跳到出错楼层 / 各按钮 */
    panel.addEventListener('click', (ev) => {
        const t = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!t) return;

        const del = t.getAttribute('data-cd-dellayer');
        if (del) {
            cfg().customLayers = (cfg().customLayers || []).filter(l => l.name !== del);
            saveSettingsDebounced(); rebuildDynamic(); schedule(true);
            return;
        }
        const jump = t.getAttribute('data-cd-jump');
        if (jump !== null && jump !== undefined && jump !== '') {
            const el = document.querySelector('#chat .mes[mesid="' + Number(jump) + '"]');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        switch (t.id) {
            case 'cd-colors-reset':
                cfg().charColors = {};
                saveSettingsDebounced(); rebuildDynamic(); schedule(true);
                return;
            case 'cd-addlayer': {
                const inp = document.getElementById('cd-newlayer');
                const v = validateLayerName(inp ? inp.value : '', allLayers(cfg()));
                if (!v.ok) { notify(v.error, 'error'); return; }
                cfg().customLayers = (cfg().customLayers || []).concat([{ name: v.name, mark: 'dashed', italic: false }]);
                if (inp) inp.value = '';
                saveSettingsDebounced(); rebuildDynamic();
                notify('已添加层「' + v.name + '」—— 再去「层样式」调它，并让模型开始输出这一层', 'success');
                return;
            }
            case 'cd-card-save': {
                const k = cardKey();
                if (!k) { notify('没有加载角色卡 → 逐卡配置不可用', 'error'); return; }
                const c = cfg();
                const pick = {};
                for (const key of ['nameColMode', 'nameColWidth', 'rowGap', 'leadIndent', 'indentOnlyWrapped',
                    'markErrors', 'onlyChar', 'layerStyles', 'charColors', 'customLayers', 'palette']) {
                    if (c[key] !== undefined) pick[key] = c[key];
                }
                c.perCard = { ...(c.perCard || {}), [k]: pick };
                saveSettingsDebounced(); rebuildDynamic();
                notify('已存为这张卡的专属配置（覆盖全局）', 'success');
                return;
            }
            case 'cd-card-clear': {
                const k = cardKey();
                if (!k) { notify('没有加载角色卡', 'error'); return; }
                const pc = { ...(cfg().perCard || {}) };
                delete pc[k];
                cfg().perCard = pc;
                saveSettingsDebounced(); rebuildDynamic();
                notify('已清除这张卡的专属配置', 'success');
                return;
            }
            case 'cd-export':
                if (download('cine-dialogue-config.json', serializeConfig(cfg()))) notify('已导出配置', 'success');
                return;
            case 'cd-import': {
                const f = document.getElementById('cd-file');
                if (f) f.click();
                return;
            }
            case 'cd-story': {
                const md = buildStoryMarkdown();
                if (download('cine-dialogue-story.md', md, 'text/markdown;charset=utf-8')) {
                    notify('已导出分镜 Markdown（' + md.length + ' 字）', 'success');
                }
                return;
            }
            case 'cd-errs':
                refreshErrorList();
                return;
            default:
                return;
        }
    });

    /* 只看某角色 */
    const only = panel.querySelector('#cd-onlychar');
    if (only) {
        only.addEventListener('change', () => {
            cfg().onlyChar = only.value;
            saveSettingsDebounced(); schedule(true);
        });
    }

    /* 搜索高亮：DOM 后处理，不重渲染 */
    const search = panel.querySelector('#cd-search');
    if (search) {
        search.value = String(cfg().highlight || '');
        search.addEventListener('input', () => { cfg().highlight = search.value; saveSettingsDebounced(); applyHighlight(); });
    }

    /* 导入配置 */
    const file = panel.querySelector('#cd-file');
    if (file) {
        file.addEventListener('change', () => {
            const f = file.files && file.files[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => {
                const r = parseConfig(String(rd.result || ''));
                if (!r.ok) { notify('导入失败：' + r.error, 'error'); return; }
                Object.assign(cfg(), r.config);
                saveSettingsDebounced(); rebuildDynamic(); applyPromptInjection(); schedule(true);
                notify('已导入配置'
                    + (r.dropped && r.dropped.length ? '（丢弃不认识的键：' + r.dropped.join(', ') + '）' : ''), 'success');
            };
            rd.onerror = () => notify('读取文件失败', 'error');
            rd.readAsText(f);
            file.value = '';
        });
    }
}

function buildSettingsPanel() {
    if (document.getElementById('cd-panel')) return;                 // 幂等
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) {
        console.warn('[' + EXT_ID + '] 找不到设置面板容器（#extensions_settings2 / #extensions_settings）→ 跳过抽屉');
        return;
    }

    const c = cfg();
    const rows = PANEL_FIELDS.map(f => fieldHTML(f, c)).join('');

    host.insertAdjacentHTML('beforeend', [
        '<div class="inline-drawer">',
        '  <div class="inline-drawer-toggle inline-drawer-header">',
        '    <b>🎞 分镜对话 Cine Dialogue v' + esc(VERSION) + '</b>',
        '    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>',
        '  </div>',
        '  <div class="inline-drawer-content">',
        '    <div id="cd-panel">',
        '      <div class="cd-hint">把「<code>名字·层 内容</code>」渲染成分镜式对话：'
        + '<b>颜色 = 角色</b>、<b>样式 = 层</b>、标签永不出现。</div>',
        rows,
        '      <div class="cd-btn-row">',
        '        <button type="button" class="menu_button" id="cd-refresh-all">立即重渲染全部</button>',
        '        <button type="button" class="menu_button" id="cd-regex-install">安装/更新专属正则</button>',
        '        <button type="button" class="menu_button" id="cd-regex-remove">移除专属正则</button>',
        '        <button type="button" class="menu_button" id="cd-diag">诊断信息</button>',
        '      </div>',
        '      <pre id="cd-hb" class="cd-heartbeat">点「诊断信息」看核内钩子接线状态 / 渲染计数</pre>',

        /* ---- 配色（L6）---- */
        '      <div class="cd-sec"><div class="cd-sec-h">配色 —— 颜色 = 角色</div>',
        '        <div id="cd-colors"></div>',
        '        <div class="cd-btn-row"><button type="button" class="menu_button" id="cd-colors-reset">重置角色配色</button></div>',
        '      </div>',

        /* ---- 层样式（L6）---- */
        '      <div class="cd-sec"><div class="cd-sec-h">层样式 —— 样式 = 层</div>',
        '        <div id="cd-layers"></div>',
        '      </div>',

        /* ---- 自定义层（L8）---- */
        '      <div class="cd-sec"><div class="cd-sec-h">自定义层</div>',
        '        <div class="cd-btn-row">',
        '          <input type="text" id="cd-newlayer" placeholder="层名（≤6 字，不含空格与 ·）">',
        '          <button type="button" class="menu_button" id="cd-addlayer">添加层</button>',
        '        </div>',
        '        <div id="cd-customlayers"></div>',
        '      </div>',

        /* ---- 交互（L2）---- */
        '      <div class="cd-sec"><div class="cd-sec-h">交互</div>',
        '        <div class="cd-line"><span class="cd-lab">只看某角色</span><select id="cd-onlychar"></select></div>',
        '        <div class="cd-line"><span class="cd-lab">搜索高亮</span><input type="text" id="cd-search" placeholder="输入关键词，回车高亮"></div>',
        '        <div class="cd-note">双击任意行复制该行 · Alt+↑ / Alt+↓ 跳到上一/下一有分镜的楼层</div>',
        '      </div>',

        /* ---- 逐卡 + 数据（L5）---- */
        '      <div class="cd-sec"><div class="cd-sec-h">这张卡 / 数据</div>',
        '        <div class="cd-btn-row">',
        '          <button type="button" class="menu_button" id="cd-card-save">存为这张卡的专属配置</button>',
        '          <button type="button" class="menu_button" id="cd-card-clear">清除这张卡的配置</button>',
        '          <button type="button" class="menu_button" id="cd-export">导出配置</button>',
        '          <button type="button" class="menu_button" id="cd-import">导入配置</button>',
        '          <button type="button" class="menu_button" id="cd-story">导出全部分镜 (Markdown)</button>',
        '        </div>',
        '        <input type="file" id="cd-file" accept=".json,application/json" class="cd-hidden">',
        '        <div id="cd-cardstate" class="cd-note"></div>',
        '      </div>',

        /* ---- 格式错误面板（L6）---- */
        '      <div class="cd-sec"><div class="cd-sec-h">格式错误（模型写漏了「层名后的空格」之类）</div>',
        '        <div class="cd-btn-row"><button type="button" class="menu_button" id="cd-errs">刷新错误列表</button></div>',
        '        <div id="cd-errlist" class="cd-errlist"></div>',
        '      </div>',
        '    </div>',
        '  </div>',
        '</div>',
    ].join('\n'));

    wirePanel();
    rebuildDynamic();

    /* 让面板里的原生控件跟着主题走（否则某些主题下 input 是白底 + 浅色文字 = 看不见） */
    const p = document.getElementById('cd-panel');
    if (p && isLightTheme()) p.classList.add('cd-light');

    console.log('[' + EXT_ID + '] 设置抽屉已挂到 #' + host.id);
}

// ---------------------------------------------------------------- 启动

function start() {
    cfg();
    bind();
    exposeApi();
    bindInteractions();
    injectStyles();
    buildSettingsPanel();
    applyPromptInjection();
    registerSlashCommand();
    console.log('[' + EXT_ID + '] v' + VERSION + ' loaded'
        + '  TavernHelper=' + (TH() ? 'yes' : 'no')
        + '  Mvu=' + (MVU() ? 'yes' : 'no')
        + '  CardCompat=' + (CC() ? 'yes' : 'no')
        + '  PlotPilot=' + (PP() ? 'yes' : 'no'));
    schedule(true);
}

// ST 启动时扩展可能早于聊天加载完 → 两个时机都试
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(start, 0);
} else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
}
