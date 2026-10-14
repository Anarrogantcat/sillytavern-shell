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
    streamingProcessor,
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
    applyPresetRecipe,

    layerClass,
    PANEL_GROUPS,
normalizeSpeechQuotes, mergeSplitTags, guessGenderFromText, parseLine, } from './logic.js';
import { cdStartButtons } from './buttons.js';

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
        /* ★★ 真机根因修复（0.8.57）：模型会把「名字·层」单独写一行、内容写在下一行。
           原文里那种写法**不是合法行** ⇒ 下面这句 hasOurLines 会返回 false ⇒
           钩子直接把原文放行 ⇒ 标签全裸露（用户：「完全是插件的问题」—— 对 ✓）。
           所以：**先合并、再判断** ✓ */
        const mergedMes = normalizeSpeechQuotes(mergeSplitTags(mes));
        if (!hasOurLines(mergedMes)) return mes;                  // 合并后仍没有我们的行 → 一个字不改

        const mid = (ctx && Number.isFinite(Number(ctx.messageId))) ? Number(ctx.messageId) : -1;

        /* 思考块兜底：预设那条思维链正则只覆盖最近 N 层，更早的层由我们折叠。
           depth 算不出来时**选择包**（宁可折叠也不要把思考摊在外面）。 */
        const mode = String(c.thinkingWrap || 'auto');
        const d = depthOf(mid);
        const wrapThinking = (mode === 'always')
            || (mode === 'auto' && (d === undefined || d > (Number(c.thinkingDepth) || 0)));

        const res = renderMessageHTML(mergedMes, { ...chatWideColors(), ...(colorMap[mid] || {}) }, c, { wrapThinking });
        if (!res || !res.html) return mes;

        if (mid >= 0) colorMap[mid] = res.colors;                 // 本楼缓存
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
    const res = renderMessage(sections.body, colorMap[mesId] = { ...chatWideColors(), ...(colorMap[mesId] || {}) }, c);
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
/** 宽表格处理计数（给 diagnose 看，不做黑箱） */
let wrappedTables = 0;
let tableCandidates = 0;

/**
 * 宽表格防挤压。★ 三道限制缺一不可：
 *   ① **只挑 .mes_text 的直接子级 table** —— markdown(showdown) 渲染出的表格是顶层子元素；
 *      卡脚本/状态栏生成的表格一定在某个容器 div 里 ⇒ 不是直接子级 ⇒ **天然不碰** ✓
 *   ② **只在真的溢出时**才包（scrollWidth > 容器宽）⇒ 本来能自适应换行的小表格不受影响 ✓
 *   ③ 容器不可见（宽度 0）时跳过 —— 隐藏元素的 scrollWidth 不可靠 ✓
 * 只加一个自有前缀 wrapper（.cd-tw），不写内联样式、不改表格本身 ✓（AGENTS §0.3.2）
 */
function wrapWideTables(mesEl) {
    try {
        if (!effectiveConfig().wrapWideTables) return;
        const textEl = mesEl.querySelector('.mes_text');
        if (!textEl) return;
        const avail = textEl.clientWidth;
        if (!avail) return;                              // ③ 不可见 → 不判
        textEl.querySelectorAll(':scope > table').forEach(t => {
            if (t.parentElement && t.parentElement.classList.contains('cd-tw')) return;   // 已包过
            tableCandidates++;
            if (t.scrollWidth <= avail + 1) return;      // ② 没溢出 → 不碰
            const box = document.createElement('div');
            box.className = 'cd-tw';
            box.setAttribute('data-cd-tw', '1');
            t.parentNode.insertBefore(box, t);
            box.appendChild(t);
            wrappedTables++;
        });
    } catch (e) { console.warn('[' + EXT_ID + '] 宽表格处理失败（不影响其它功能）', e); }
}

function decorate(mesEl) {
    try { unifyNameColumn(mesEl); } catch (_) { /* 装饰失败不影响渲染 */ }
    try { alignPlains(mesEl); } catch (_) { /* 对齐失败不影响渲染 */ }
    try { applyIndent(mesEl); } catch (_) { /* 同上 */ }
    try { wrapWideTables(mesEl); } catch (_) { /* 表格处理失败不影响渲染 */ }
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
    /* 总开关关掉 → 整条路径短路（连 decorate 都不跑，避免动到 DOM） */
    if (!effectiveConfig().enabled) return;
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

// ---------------------------------------------------------------- 流式边出边排版（可开关）

/**
 * ★★ 1.9.0（用户要求：「让流式输出边出边排版 做，但设置成可开关的」）
 *
 * 为什么**不用动本体**：ST 每 tick 都会写
 *     `script.js:3693  this.messageTextDom.innerHTML = formattedText;`
 * ⇒ 扩展只要在 ST 写完之后**再写一次**即可 ✓
 *
 * 怎么拿到"逐 tick 的累积原文"：
 *   包装**内存里那个实例**的方法（`streamingProcessor.onProgressStreaming`）✓
 *   —— 不改任何文件、不动本体、ST 更新也不会因此报废 ✓
 *   （§0.5 第 1 条：扩展层能做到就不动本体 ✓）
 *
 * 安全阀：
 *   · 开关 `streamLiveFormat` **默认关** ✓（面板「性能」组里可开 ✓）
 *   · 节流 120ms（别每 token 都重排 ✗）
 *   · 只有**认得出来是我们的行**才接管 ✓；认不出 ⇒ 保留 ST 原样输出 ✓（永不丢字 ✓）
 *   · 只动 `messageTextDom.innerHTML` ✓ 其它节点一个字节不碰 ✓
 */
let cdLiveAt = 0;
function cdLiveFormat(text) {
    try {
        const cfgNow = effectiveConfig();
        if (!cfgNow.streamLiveFormat || !cfgNow.enabled) return false;
        if (typeof text !== 'string' || !text) return false;
        if (!hasOurLines(text)) return false;                 /* 不是分镜格式 ⇒ 不碰 ✓ */
        const now = Date.now();
        if (now - cdLiveAt < 120) return false;               /* 节流 ✓ */
        cdLiveAt = now;
        const r = renderMessageHTML(text, {}, cfgNow);
        if (!r || !r.html) return false;                      /* 认不出 ⇒ 交给 ST ✓ */
        const sp = streamingProcessor;
        const dom = sp && sp.messageTextDom;
        if (!(dom instanceof HTMLElement)) return false;
        dom.innerHTML = r.html;
        return true;
    } catch (e) { return false; }
}

/** 幂等包装：每次生成 ST 都会 new 一个 StreamingProcessor ⇒ 每轮重新包 ✓ */
function cdArmStreamLive() {
    try {
        const sp = streamingProcessor;
        if (!sp || typeof sp.onProgressStreaming !== 'function' || sp.__cdLivePatched) return;
        const orig = sp.onProgressStreaming.bind(sp);
        sp.__cdLivePatched = true;
        sp.onProgressStreaming = async function (messageId, text, isFinal) {
            const out = await orig(messageId, text, isFinal);
            try { cdLiveFormat(text); } catch (_) { }
            return out;
        };
    } catch (e) { try { console.warn('[' + EXT_ID + '] 流式包装失败（不影响正常渲染）', e); } catch (_) { } }
}

if (typeof window !== 'undefined') {
    /* 供诊断用：手动打一次（面板「诊断本楼」那种场景也能复用 ✓） */
    window.CineDialogueLiveFormat = cdLiveFormat;
}

// ---------------------------------------------------------------- 事件（6 个触发点）

function bind() {
    const safe = (fn) => () => { try { fn(); } catch (e) { console.error('[' + EXT_ID + ']', e); } };

    /* ★ 1.9.0：每个生成开始都重新包装一次流式处理器（ST 每轮 new 一个新实例 ✓） */
    eventSource.on(event_types.GENERATION_STARTED, safe(() => { cdLiveAt = 0; cdArmStreamLive(); }));
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, safe(() => {
        /* 兜底：万一 onProgressStreaming 包装失败（ST 改结构），这里还能按"累积不到原文"退回 ✓ */
        cdArmStreamLive();
    }));

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

    /* ★★ 1.9.2：改用 **ST 1.19 的官方 `MessageFormatter`** ✓（这样**不再需要核内补丁** ✓）
       由来：1.19 的更新日志 Extensions 段 ——
         「Added MessageFormatter, allowing extensions to transform message content
           before regex processing, after regex processing, or after Markdown conversion.」
       这正是补丁 #001 干的事 ⇒ 用官方 API 就能达到同样效果：
         · 阶段 BEFORE_REGEX（= 我们的诉求：regex / markdown / DOMPurify 都还没跑 ✓）
         · 同时设 `window.__cdMessageFormattingHook = true` ⇒ 与补丁路径**同一个接线标记** ✓
           ⇒ 于是 hookActive() 为真、走同一条"标签永不进 DOM"的主路径 ✓
       两条路可以并存（打了补丁也不会重复转换：补丁先调一次，本钩子再调一次 —— 幂等 ✓
       因为 formatHook 对**已经转换过**的文本（含 <div class="custom-cd-…>>）认不出分镜行 ⇒ 原样返回 ✓）
    */
    try {
        const mf = (typeof getContext === 'function') ? getContext().messageFormatter : null;
        if (mf && typeof mf.addHook === 'function' && !window.__cdMsgHookAdded) {
            window.__cdMsgHookAdded = true;
        /* ★★ 1.9.4：官方钩子路径**也**置接线标记 —— 实测该标记原先只有核内补丁会设，
           撤掉补丁后它会一直是 false ⇒ 扩展会悄悄退化到 DOM 后处理兜底路径 ✗。
           真机验证（撤补丁 + 强制重渲染）：钩子路径 rows=62 / leak=0，与兜底路径结构一致 ✓ */
        window.__cdMessageFormattingHook = true;
            mf.addHook((mes, hookCtx) => {
                try {
                    if (typeof mes !== 'string' || !mes) return mes;
                    const out = formatHook(mes, hookCtx || {});
                    if (typeof out === 'string' && out !== mes) {
                        window.__cdMessageFormattingHook = true;   /* 与补丁同一个接线标记 ✓ */
                        return out;
                    }
                    return mes;
                } catch (e) {
                    try { console.warn('[cine-dialogue] MessageFormatter 钩子失败（原样返回）', e); } catch (_) { }
                    return mes;
                }
            }, { stage: mf.stage.BEFORE_REGEX, order: mf.order.LATE });
            console.info('[cine-dialogue] 已挂 ST 官方 MessageFormatter 钩子（BEFORE_REGEX / LATE）—— 不再需要核内补丁 ✓');
        }
    } catch (e) { try { console.warn('[cine-dialogue] MessageFormatter 注册失败（会退回 DOM 后处理）', e); } catch (_) { } }

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
                failedSteps: failedSteps.slice(),
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
        const use = !!c.injectPrompt && !!c.enabled;      // ★ 总开关关掉 → 注入清空
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
    /* ★ 先检查再问：已经装好且内容没变 → 明确告诉用户「重装只会再重载一次聊天」 */
    const st = regexState();
    const fp = regexFingerprint();
    let stamp = '';
    try { stamp = localStorage.getItem('cd-regex-stamp') || ''; } catch (_) { stamp = ''; }
    if (st.ok && st.readable && stamp && stamp === fp) {
        const go = await confirmRegexAction('专属正则：已经装好了',
            '4 条专属正则**已经装好、内容也没变**。' + String.fromCharCode(10, 10)
            + '重装只会把它们再写一遍，并**重载一次聊天**（会卡几秒）。' + String.fromCharCode(10)
            + '如果你不是想强制重载，建议直接点「取消」。');
        if (!go) { notify('已取消（正则本来就是最新的）', 'info'); return false; }
    } else {
        const go = await confirmRegexAction('安装/更新专属正则',
            '会往你的正则列表写入 4 条（只作用最近 3 楼、只改显示，不动提示词）。' + String.fromCharCode(10, 10)
            + '⚠️ 这一步会**重载整个聊天**（会卡几秒）。确定继续？');
        if (!go) { notify('已取消安装', 'info'); return false; }
    }
    try {
        const want = buildRegexes();
        const mine = new Set(want.map(r => r.script_name));
        await TH().updateTavernRegexesWith(list =>
            (Array.isArray(list) ? list : [])
                .filter(r => !mine.has(r && r.script_name) && !String((r && r.id) || '').startsWith('cd-r'))
                .concat(want)
        , { type: 'global' });
        try { localStorage.setItem('cd-regex-stamp', regexFingerprint()); } catch (_) { /* 记不住指纹只影响下次的提示 */ }
        refreshRegexState();
        if (!silent) notify('【分镜】专属正则已安装/更新（4 条，只作用最近 3 楼）', 'success');
        console.log('[' + EXT_ID + '] 专属正则已写入（全局，display-only）');
        return true;
    } catch (e) {
        console.error('[' + EXT_ID + '] 安装专属正则失败', e);
        if (!silent) notify('专属正则安装失败：' + (e && e.message ? e.message : String(e)), 'error');
        return false;
    }
}

/* ---------------------------------------------------------------- 专属正则：状态检查 + 确认
   为什么需要：`updateTavernRegexesWith` **会重载整个聊天** —— 重复点「安装」不会装重（我们幂等），
   但会白白重载一次聊天（用户反馈：「我刚刚就不小心点了安装」）。
   所以：① 先**检查**当前装没装、内容变没变；② 装/卸前**确认**，并写明会重载聊天。 */

/** 读当前的正则列表。★ 读不到就返回 null（只影响状态显示，不影响安装/移除） */
function readRegexList() {
    const th = TH() || {};
    const w = window.TavernHelper || {};
    const tries = [
        () => (typeof th.getTavernRegexes === 'function') ? th.getTavernRegexes({ type: 'global' }) : null,
        () => (typeof th.getTavernRegexes === 'function') ? th.getTavernRegexes() : null,
        () => Array.isArray(th.tavernRegexes) ? th.tavernRegexes : null,
        () => (typeof w.getTavernRegexes === 'function') ? w.getTavernRegexes({ type: 'global' }) : null,
    ];
    for (const f of tries) {
        try { const v = f(); if (Array.isArray(v)) return v; } catch (_) { /* 换下一种读法 */ }
    }
    return null;
}

/** 我们这 4 条的「内容指纹」—— 用来判断装过之后内容有没有变 */
function regexFingerprint() {
    try { return JSON.stringify(REGEX_DEFS.map(d => [d.script_name, d.find_regex, d.replace_string, !!d.enabled, d.max_depth])); }
    catch (_) { return ''; }
}

/** 当前状态：{ available, readable, installed[], missing[], ok } */
function regexState() {
    if (!regexAvailable()) return { available: false, readable: false, installed: [], missing: REGEX_DEFS.map(d => d.script_name), ok: false, total: REGEX_DEFS.length };
    const list = readRegexList();
    if (list === null) return { available: true, readable: false, installed: [], missing: [], ok: false, total: REGEX_DEFS.length };
    const names = new Set(list.map(r => String((r && (r.script_name || r.scriptName)) || '')));
    const installed = REGEX_DEFS.filter(d => names.has(d.script_name)).map(d => d.script_name);
    const missing = REGEX_DEFS.filter(d => !names.has(d.script_name)).map(d => d.script_name);
    return { available: true, readable: true, installed, missing, ok: installed.length === REGEX_DEFS.length, total: REGEX_DEFS.length };
}

/** 把状态写进面板那一行（顺便把按钮文案做成有信息量的） */
function refreshRegexState() {
    const el = document.getElementById('cd-regex-state');
    const st = regexState();
    if (el) {
        if (!st.available) el.textContent = '专属正则：需要酒馆助手（TavernHelper）才能安装 —— 没装也不影响渲染。';
        else if (!st.readable) el.textContent = '专属正则：读不到列表（不影响安装）—— 安装前会再问你一次。';
        else if (st.ok) el.textContent = '专属正则：已安装 ' + st.installed.length + '/' + st.total + ' 条（只作用最近 3 楼、只改显示）—— 重装只会重载一次聊天。';
        else if (st.installed.length) el.textContent = '专属正则：装了 ' + st.installed.length + '/' + st.total + ' 条，缺：' + st.missing.join('、') + ' —— 建议点「安装/更新」。';
        else el.textContent = '专属正则：未安装（装与不装都不影响渲染，只在 DOM 降级路径下需要）。';
    }
    return st;
}

/** 装/卸前的确认。★ 会重载整个聊天，所以要问清楚；弹窗 API 不可用时退到 window.confirm */
async function confirmRegexAction(title, text) {
    try {
        if (typeof callGenericPopup === 'function' && typeof POPUP_TYPE !== 'undefined') {
            const r = await callGenericPopup(text, POPUP_TYPE.CONFIRM, title, { okButton: '继续', cancelButton: '取消' });
            const YES = (typeof POPUP_RESULT !== 'undefined' && POPUP_RESULT) ? POPUP_RESULT.AFFIRMATIVE : 1;
            return r === YES;
        }
    } catch (_) { /* 退到 window.confirm */ }
    try { return window.confirm(title + String.fromCharCode(10, 10) + text); } catch (_) { return true; }
}

/** 卸载我们注册的正则（只删自己的，不碰别人的） */
async function removeRegexes() {
    if (!regexAvailable()) { notify('需要酒馆助手才能改正则', 'warning'); return false; }
    {
        const go = await confirmRegexAction('移除专属正则',
            '会从你的正则列表里删掉我们的 4 条，并**重载整个聊天**（会卡几秒）。' + String.fromCharCode(10, 10) + '确定继续？');
        if (!go) { notify('已取消移除', 'info'); return false; }
    }
    try {
        const mine = new Set(REGEX_DEFS.map(d => d.script_name));
        await TH().updateTavernRegexesWith(list =>
            (Array.isArray(list) ? list : [])
                .filter(r => !mine.has(r && r.script_name) && !String((r && r.id) || '').startsWith('cd-r'))
        , { type: 'global' });
        try { localStorage.removeItem('cd-regex-stamp'); } catch (_) { /* 无所谓 */ }
        refreshRegexState();
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

/** 启动时失败的步骤（每一步单独兜错，见 start()）—— 面板/控制台/对外 API 都能看到 */
const failedSteps = [];

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

/**
 * ★★ 聊天级确定性配色（用户要求「强制替换」，不要「已钉死」那种半成品）
 * 扫整个聊天，按角色**首次出场顺序**分配调色板 ⇒ 主角/最早出场者 = 第 1 色（青）；
 * 每楼结果一致（与"哪楼先渲染"无关）✓ 不读也不写 settings.charColors ✗
 */
let chatColorCache = { key: "", map: {} };
function chatColorKey() {
    try {
        const ctx = getContext();
        const card = (ctx.characters && ctx.characters[ctx.characterId] && ctx.characters[ctx.characterId].avatar) || "";
        return card + "|" + ((ctx.chat && ctx.chat.length) || 0);
    } catch (_) { return ""; }
}
function chatWideColors() {
    const key = chatColorKey();
    if (chatColorCache.key === key) return chatColorCache.map;
    const c = effectiveConfig();
    const layers = allLayers(c);
    const names = [];
    const seen = new Set();
    try {
        const chat = getContext().chat || [];
        for (const msg of chat) {
            if (!msg || msg.is_user) continue;
            for (const raw of String(msg.mes || "").split("\n")) {
                const t = raw.trim();
                if (!t) continue;
                const p = parseLine(t, layers, !!c.lenientLayers);
                if (p.kind === "row" && p.name && !seen.has(p.name)) { seen.add(p.name); names.push(p.name); }
            }
        }
    } catch (_) { }
      /* ★ 只给**用户角色**绑色（用户要求）：
         · user 是男性 ⇒ 蓝；user 是女性 / 扶她 ⇒ 紫
         · **其他角色完全不套用**（保持各自按出场顺序的自动配色）
           —— 上一版把所有人都按性别绑了，那是错的 ✗
         · 面板的蓝/紫名单仍可用（你手工指定某人时才生效）✓ */
      let userName = "";
      let userColor = String(c.roleBlueColor || "#3B82F6");
      try {
          const ctx = getContext();
          userName = String(ctx.name1 || "").trim();
          if (userName) {
              let personaText = userName;
              try {
                  const pu = ctx.powerUser || {};
                  const pmap = pu.personas || {};
                  for (const k of Object.keys(pmap)) {
                      if (String(k) === userName || String(pmap[k] || "").indexOf(userName) >= 0) {
                          personaText += " " + String(k) + " " + String(pmap[k] || "");
                      }
                  }
              } catch (_) { }
              try {
                  const me = ctx.characters && ctx.characters[ctx.characterId];
                  if (me) personaText += " " + String(me.description || "");
              } catch (_) { }
              const g = guessGenderFromText(userName, personaText);
              userColor = String((g === "female" || g === "futa")
                  ? (c.rolePurpleColor || "#A855F7")
                  : (c.roleBlueColor || "#3B82F6"));
          }
      } catch (_) { }
      const cf = c;
      const map = resolveColors(names, cf, userName ? { [userName]: userColor } : {});
    chatColorCache = { key, map };
    return map;
}

/** 一次性迁移：清掉 0.8.13~0.8.19 期间我自动写进 charColors 的错误颜色 */
/**
 * 一次性迁移：把**老默认值** rowGap=0.8 改成 0.5。
 * 为什么：我当年"修间距"时只改了**默认值**，而用户配置里已经存着 0.8，
 * 所以那个修复从来没对用户生效（用户反馈「间距有点大」）。这里做一次迁移。
 * 用户在面板里改过的话，之后的版本不会再动它（stamp 只跑一次）。
 */
/**
 * 一次性迁移：把「空行分组之间画分隔线」打开（用户 2026-10-14：「把默认值改成 true」）。
 * 为什么需要迁移：默认值改了**碰不到已经保存的配置** ✗（用户配置里存着 false）
 * 只跑一次（stamp）⇒ 之后你在面板关掉，不会再被翻回来 ✓
 */
function migrateSeparators() {
    try {
        const c = cfg();
        if (c.sepStamp === 'v2') return;
        if (c.showSeparators !== true) {
            c.showSeparators = true;
            saveSettingsDebounced();
            console.info('[' + EXT_ID + '] 已打开「分组之间画分隔线」（可在面板关闭）');
        }
        c.sepStamp = 'v2';
        saveSettingsDebounced();
    } catch (e) { console.warn('[' + EXT_ID + '] 分隔线迁移失败（不影响渲染）', e); }
}

/**
 * ★ 1.7.0 一次性迁移：**关掉我们自己的 R2 / R3 两条正则**
 *   用户要求：「插件的选择状态栏不要影响到角色卡自带的前端和选择状态栏」✓
 *   为什么必须关：
 *     · R3「选项区包成 [OPTIONS]」会在**钩子之前**把卡的 `<options>…</options>`
 *       改写成 `[OPTIONS]…[/OPTIONS]` ✗ ⇒ **卡自己的渲染器找不到 `<options>`** ⇒
 *       卡自带的选项栏就画不出来 ✗（真机实测确认 ✓）
 *     · R2 同理：把前端区包成 `[FRONTEND]`，而 `[FRONTEND]` 在我们这里是**整段跳过**的 ✗
 *   为什么可以关：我们的 `splitSections` **直接认** `<htmlcontent>` / `<options>` 原形 ✓
 *     （两条路都支持 ✓）⇒ R2/R3 **本来就多余** ✗
 *   只跑一次（stamp）⇒ 之后你手动打开也不会被翻回去 ✓
 */
function migrateRegexR23() {
    try {
        const st = (typeof extension_settings === 'object' && extension_settings) || null;
        if (!st) return;
        const list = Array.isArray(st.regex) ? st.regex : (st.regex && typeof st.regex === 'object' ? Object.values(st.regex) : []);
        if (!list.length) return;
        let n = 0;
        for (const r of list) {
            const nm = String((r && (r.scriptName || r.name)) || '');
            if (!/【分镜】R[23]\b/.test(nm) && !/R2 前端区包成|R3 选项区包成/.test(nm)) continue;
            if (r.disabled) continue;
            r.disabled = true;
            n++;
        }
        if (n) {
            saveSettingsDebounced();
            console.info('[' + EXT_ID + '] 已关闭 ' + n + ' 条会改写卡标签的自家正则（R2/R3）—— 保护卡自带的前端 ✓');
        }
    } catch (e) { console.warn('[' + EXT_ID + '] R2/R3 迁移失败（不影响渲染）', e); }
}

function migrateRowGap() {
    try {
        const c = cfg();
        if (c.rowGapStamp === 'v2') return;
        if (Number(c.rowGap) === 0.8) {
            c.rowGap = 0.5;
            c.rowGapStamp = 'v2';
            saveSettingsDebounced();
            console.info('[' + EXT_ID + '] 行间距已从老默认 0.8 迁移为 0.5');
        } else {
            c.rowGapStamp = 'v2';
            saveSettingsDebounced();
        }
    } catch (e) { console.warn('[' + EXT_ID + '] 行间距迁移失败（不影响渲染）', e); }
}

function migrateColorStamp() {
    try {
        const c = cfg();
        if (c.colorStamp === 'v2') return;
        c.charColors = {};
        c.colorStamp = 'v2';
        saveSettingsDebounced();
        console.info('[' + EXT_ID + '] 已清空历史自动写入的角色配色（改为按聊天自动计算）');
    } catch (e) { console.warn('[' + EXT_ID + '] 配色迁移失败（不影响渲染）', e); }
}

function cardKey() {
    try {
        const ctx = getContext();
        const c = ctx.characters && ctx.characters[ctx.characterId];
        return (c && c.avatar) ? String(c.avatar) : '';
    } catch (_) { return ''; }
}

/**
 * ★ 1.7.0：当前角色卡是否**自带前端**（状态栏 / 选项栏 / MVU / TavernHelper）
 *   用户要求：「插件的选择状态栏不要影响到角色卡自带的前端和选择状态栏，
 *             有自己美化的是明显不兼容的」✓
 *   ⇒ 卡自带前端时，我们**不渲染自己的选项栏**，把 `<options>` 块原样透传给卡 ✓
 *   判据（扫描这张卡的 JSON：描述 / 首条 / 世界书条目 / 扩展字段）：
 *     StatusPlaceHolderImpl · <option · <StatusBar> · UpdateVariable · TavernHelper · stat_data · <%
 *   带缓存（按卡 avatar 作键）✓ —— 卡的世界书可能有几百条，不能每条消息都 JSON.stringify ✗
 */
/**
 * ★★ 1.8.2：判据**改成"真有渲染器才认"** ✓
 *   用户一句「我怎么没看出来有美化」把我问住了 —— **他说得对** ✗：
 *   · 卡 JSON 里躺着 `<style>` / CSS 文本 ⇒ **没有渲染器就等于没生效** ✗（看不见 ✓）
 *   · `## ` / `**加粗**` 是 **ST 自己**渲染的 ✗ ⇒ 根本不算"卡的美化" ✓
 *   ⇒ 所以 1.8.1 的 97/107 是**虚高且归因错误**的 ✗
 *   真正**能看见**的效果只来自：
 *     · **占位符**（`<StatusPlaceHolderImpl/>` / `<option/>` / `<StatusBar>`）—— 由 card-compat 渲染 ✓
 *     · **TavernHelper `<%…%>` 脚本**（装上且绑定到卡才会跑 ✓）
 *     · **MVU / UpdateVariable**（变量状态栏 ✓）
 *   ⇒ 只按这三类判定 ✓（CSS / markdown 一律不算 ✗）
 */
let cardFECache = { key: '', val: false };
function cardHasFrontend() {
    try {
        const ctx = getContext();
        const c = ctx.characters && ctx.characters[ctx.characterId];
        if (!c) return false;
        const key = String(c.avatar || c.name || '');
        if (cardFECache.key === key) return cardFECache.val;
        const s = JSON.stringify(c);
        /* 只认"真的有东西会去渲染它"的标记 ✓ */
        const RENDER_RE = /StatusPlaceHolderImpl|<option\s*\/?>|<StatusBar>|UpdateVariable|TavernHelper|stat_data|<%/i;
        const val = RENDER_RE.test(s);
        cardFECache = { key, val };
        return val;
    } catch (_) { return false; }
}

/** 当前生效配置 = 全局配置 + 本卡覆盖 */
function effectiveConfig() {
    const base = cfg();
    const key = cardKey();
    const fe = cardHasFrontend();
    /* ★★ 逐卡「本卡不生效」（面板里那个按钮）：在这里把它翻成 enabled:false。
       为什么只在这一个点做：**所有**已有的 enabled 检查点（渲染钩子 / run / 提示词注入 /
       Alt+↑↓ / 宽表格处理 / 交互绑定 / 恢复原文）都会自动跟着失效，不必逐处再加判断 ✓
       —— 这就是**你自己判定**的开关 ✓ */
    let merged = base;
    if (key && base.perCard && base.perCard[key]) merged = { ...base, ...base.perCard[key] };
    /* 运行期注入：本卡是否自带前端（决定要不要抢它的选项栏 ✓） */
    merged = { ...merged, cardHasFrontend: fe };
    /* ★★ 1.8.3（你选的「我自己维护黑名单」）：
       **默认不自动让位** ✓（`autoOffCardFrontend` 默认 false ⇒ 都渲染 ✓）
       这段自动让位的代码**留着** ✓ —— 你想用时把开关设成 true 即可（那时可用「强制启用」绕过 ✓）
       ⇒ 平时判定权在你：面板「这张卡不生效（自带美化的卡用它）」/ 发送栏「本卡生效/不生效」✓ */
    if (merged.autoOffCardFrontend === true && fe && !(merged.force === true)) {
        return { ...merged, enabled: false, off: true, autoOff: true };
    }
    if (merged.off) return { ...merged, enabled: false, off: true };
    return merged;
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
        if (!effectiveConfig().enabled || !effectiveConfig().copyOnClick) return;
        const body = ev.target && ev.target.closest ? ev.target.closest('.custom-cd-body') : null;
        if (!body) return;
        const row = body.closest('.custom-cd-row');
        const who = row ? (row.querySelector('.custom-cd-who') || {}).textContent : '';
        const w = String(who || '').trim();
        copyText((w ? w + '：' : '') + (body.textContent || ''));
    });

    document.addEventListener('keydown', (ev) => {
        if (!effectiveConfig().enabled) return;      // ★ 总开关关掉 → 不接管 Alt+↑/↓
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
'.custom-cd-body{color:var(--c,inherit)}',
'.custom-cd-body q,.custom-cd-body em,.custom-cd-body i,.custom-cd-body strong{color:inherit;font-style:inherit}',
    '.custom-cd-body{min-width:0;border-left:var(--cd-mark-w,3px) var(--cd-mark,solid) var(--cd-mark-color,transparent);',
    'font-style:var(--cd-italic,normal);padding-left:calc(.7em - var(--cd-pad-comp,0px))}',
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
'.custom-cd-anchor{display:none}',
'.custom-cd-img{max-width:100%;height:auto;border-radius:4px;display:block;margin:.35em 0}',
'.custom-cd-body .custom-cd-img{display:inline-block;vertical-align:middle;margin:0 .2em}',
'.custom-cd-who.custom-cd-noname{display:none}',
'.custom-cd-who.custom-cd-noname + .custom-cd-body{grid-column:1 / -1}',
'.cd-tw{overflow-x:auto;max-width:100%}','.cd-tw>table{white-space:nowrap}',
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
        /* 逐卡「不生效」—— 报出来，免得你以为插件坏了 */
        cardOff: { off: !!effectiveConfig().off, card: cardKey() || '(无)' },
        /* 宽表格处理情况 —— 让用户看得到「它动了什么」，不是黑箱 */
        tables: { wrapped: wrappedTables, candidates: tableCandidates, on: !!effectiveConfig().wrapWideTables },
        failedSteps: failedSteps.slice(),
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
        const isOff = !!(k && c.perCard && c.perCard[k] && c.perCard[k].off);
        stEl.textContent = k
            ? (isOff
                ? ('⛔ 当前卡：' + k + ' —— 已设为「不生效」，插件对这张卡完全不动作（再按一次按钮可恢复）')
                : ('当前卡：' + k + (has ? ' —— 已有专属配置（覆盖全局）' : ' —— 没有专属配置，用全局设置')))
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
            /* ★ 总开关：关掉要恢复已渲染的楼层、并清掉提示词注入（不是只停渲染） */
            if (key === 'enabled') { applyMasterSwitch(); return; }
            schedule(true);                       // 改完立即全量重渲染
        });
    });

    const refresh = panel.querySelector('#cd-refresh-all');
    if (refresh) refresh.addEventListener('click', () => schedule(true));

    const regIn = panel.querySelector('#cd-regex-install');
    if (regIn) regIn.addEventListener('click', () => installRegexes(false));

    const regRm = panel.querySelector('#cd-regex-remove');
    if (regRm) regRm.addEventListener('click', () => removeRegexes());

    /* ★ 专属预设生成：全部在浏览器里完成，不上传、不外发 */
    const presetFile = panel.querySelector('#cd-preset-file');
    const presetOut = panel.querySelector('#cd-preset-out');
    const readPresetFile = () => new Promise((res, rej) => {
        const f = presetFile && presetFile.files && presetFile.files[0];
        if (!f) { rej(new Error('先在上面选一个预设 JSON 文件')); return; }
        const fr = new FileReader();
        fr.onload = () => res({ name: f.name, text: String(fr.result || '') });
        fr.onerror = () => rej(new Error('读取文件失败'));
        fr.readAsText(f, 'utf-8');
    });
    const sha256OfText = async (text) => {
        try {
            const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
            return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (_) { return ''; }   // 拿不到哈希不影响生成，只是少了「从哪一版派生」的记录
    };
    const runPresetRecipe = async (download) => {
        try {
            if (presetOut) presetOut.textContent = '处理中…';
            const { name, text } = await readPresetFile();
            let obj;
            try { obj = JSON.parse(text); } catch (e) { throw new Error('这个文件不是合法 JSON'); }
            const hash = await sha256OfText(text);
            const r = applyPresetRecipe(obj, { srcName: name, srcHash: hash });
            if (!r.ok) throw new Error(r.changes.join('；'));
            if (presetOut) {
                presetOut.textContent = r.changes.map(c => '· ' + c).join('\n')
                    + '\n\n提示词 ' + r.stats.promptsFrom + ' → ' + r.stats.promptsTo
                    + ' · 顺序 ' + r.stats.orderFrom + ' → ' + r.stats.orderTo
                    + '（其中启用 ' + r.stats.enabledTo + ' 条）';
            }
            if (!download) { notify('已算出会改什么（没有写文件）', 'info'); return; }
            const outName = name.replace(/\.json$/i, '') + ' + 分镜.json';
            const blob = new Blob([JSON.stringify(r.preset, null, 4)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = outName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            notify('已生成「' + outName + '」—— 到 ST 的预设面板导入它', 'success');
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            if (presetOut) presetOut.textContent = '✗ ' + msg;
            notify('生成失败：' + msg, 'error');
        }
    };
    /* ★ 选文件：按钮 → 隐藏的 input；选完立刻显示文件名并**自动预演一次**，
       让用户马上看到「确实读到了、确实算出了要改什么」。 */
    const presetPick = panel.querySelector('#cd-preset-pick');
    const presetName = panel.querySelector('#cd-preset-name');
    if (presetPick && presetFile) presetPick.addEventListener('click', () => presetFile.click());
    if (presetFile) {
        presetFile.addEventListener('change', () => {
            const f = presetFile.files && presetFile.files[0];
            if (presetName) presetName.textContent = f ? f.name : '未选择';
            if (f) runPresetRecipe(false);      // 自动预演：只报会改什么，不下载
        });
    }

    const makeBtn = panel.querySelector('#cd-preset-make');
    if (makeBtn) makeBtn.addEventListener('click', () => runPresetRecipe(true));
    const dryBtn = panel.querySelector('#cd-preset-dry');
    if (dryBtn) dryBtn.addEventListener('click', () => runPresetRecipe(false));

    /* ★ 扩展信息卡：折叠状态 + 查看日志 */
    /* ★「怎么看」折叠块（默认折叠，状态记 localStorage） */
    /* ★ 面板分组折叠：读写 localStorage，默认值来自 PANEL_GROUPS */
    const GRP_KEY = 'cd-grp-open';
    const readGrpState = () => {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(GRP_KEY) || '{}') || {}; } catch (_) { saved = {}; }
        return saved;
    };
    const applyGrpState = () => {
        const saved = readGrpState();
        PANEL_GROUPS.forEach(g => {
            const open = Object.prototype.hasOwnProperty.call(saved, g.name) ? !!saved[g.name] : !!g.open;
            const body = panel.querySelector('[data-cd-grp-body="' + g.name + '"]');
            const tg = panel.querySelector('[data-cd-grp-toggle="' + g.name + '"]');
            if (body) body.style.display = open ? '' : 'none';
            if (tg) { tg.setAttribute('aria-expanded', open ? 'true' : 'false'); tg.textContent = (open ? '▾ ' : '▸ ') + g.name; }
        });
    };
    panel.addEventListener('click', (ev) => {
        const tg = ev.target && ev.target.closest ? ev.target.closest('[data-cd-grp-toggle]') : null;
        if (!tg) return;
        const name = tg.getAttribute('data-cd-grp-toggle');
        const saved = readGrpState();
        const body = panel.querySelector('[data-cd-grp-body="' + name + '"]');
        saved[name] = !(body && body.style.display !== 'none');
        try { localStorage.setItem(GRP_KEY, JSON.stringify(saved)); } catch (_) { /* 存不了只影响本次 */ }
        applyGrpState();
    });
    applyGrpState();

    const howtoTg = panel.querySelector('#cd-howto-toggle');
    if (howtoTg) {
        howtoTg.addEventListener('click', () => {
            const body = document.getElementById('cd-howto-body');
            const open = !(body && body.style.display !== 'none');
            if (body) body.style.display = open ? '' : 'none';
            howtoTg.setAttribute('aria-expanded', open ? 'true' : 'false');
            howtoTg.textContent = (open ? '▾ ' : 'ⓘ ') + '怎么看（颜色 / 层样式 / 记号）';
            try { localStorage.setItem('cd-howto-open', open ? '1' : '0'); } catch (_) { /* 存不了只影响本次 */ }
        });
        try {
            if (localStorage.getItem('cd-howto-open') === '1') {
                const body = document.getElementById('cd-howto-body');
                if (body) body.style.display = '';
                howtoTg.setAttribute('aria-expanded', 'true');
                howtoTg.textContent = '▾ 怎么看（颜色 / 层样式 / 记号）';
            }
        } catch (_) { /* 读不到保持折叠 */ }
    }

    const infoTg = panel.querySelector('#cd-info-toggle');
    if (infoTg) {
        infoTg.addEventListener('click', () => {
            const body = document.getElementById('cd-info-body');
            const open = !(body && body.style.display !== 'none');
            try { localStorage.setItem(CD_INFO_KEY, open ? '1' : '0'); } catch (_) { /* 存不了只影响本次 */ }
            applyInfoOpen();
        });
    }
    const infoLog = panel.querySelector('#cd-info-log');
    if (infoLog) infoLog.addEventListener('click', () => showChangelog());

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
            /* ★ 逐卡「本卡不生效」：切换 off。
               只动 off 这一个键 —— 这张卡其它的专属配置（颜色/层样式…）原样保留 ✓ */
            case 'cd-card-off': {
                const kOff = cardKey();
                if (!kOff) { notify('没有加载角色卡 → 逐卡设置不可用', 'error'); return; }
                const cOff = cfg();
                const pcOff = { ...(cOff.perCard || {}) };
                const cur = { ...(pcOff[kOff] || {}) };
                if (cur.off) {
                    delete cur.off;
                    if (Object.keys(cur).length) pcOff[kOff] = cur; else delete pcOff[kOff];
                    notify('已恢复：这张卡重新生效', 'success');
                } else {
                    cur.off = true;
                    pcOff[kOff] = cur;
                    notify('已设为「这张卡不生效」：插件对这张卡完全不动作（其它卡不受影响）', 'success');
                }
                cOff.perCard = pcOff;
                saveSettingsDebounced();
                rebuildDynamic();
                restoreAllMessages();
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

/* ★ 专属预设（在用户本机生成）
   为什么不在插件里附带预设：原预设许可写着「可以二改，**禁止二传**」。
   所以插件只带**配方**（applyPresetRecipe），预设本体由用户自己那份原预设现场派生。 */
/* ── 图例：把「颜色 = 角色、样式 = 层」讲清楚 ──
   为什么必须给图例：面板原来只有一句「颜色 = 角色」，用户看到聊天里一排颜色，
   无法知道哪个颜色是谁、竖线又代表什么。这里放的是**真渲染**（用消息区同一套类），不是图片。
   层别约定从 DEFAULT_LAYER_STYLES 生成 —— 改了默认值，说明文字自动跟着变，不会对不上。 */
/**
 * 「怎么看」折叠块 —— 把 图例 / 层别约定 / 配色规则 / 记号说明 收成一处。
 * ★ 默认折叠：这些是**查阅型**内容，不折叠会把面板撑得很长，反而挡住常用开关。
 *   折叠状态记 localStorage（与扩展信息卡同一套做法）。
 */
function howtoSecHTML() {
    const conv = ['台词', '动作', '感官', '心理', '旁白'].map(L => {
        const st = DEFAULT_LAYER_STYLES[L] || {};
        const mk = (st.mark && st.mark !== 'none') ? (MARK_LABEL[st.mark] || st.mark) : '无竖线';
        return L + ' = ' + mk + (st.italic ? ' + 斜体' : '');
    }).join('　｜　');
    return [
        '      <div id="cd-howto" class="cd-howto">',
        '        <div id="cd-howto-toggle" class="cd-howto-toggle" role="button" tabindex="0" aria-expanded="false">ⓘ 怎么看（颜色 / 层样式 / 记号）</div>',
        '        <div id="cd-howto-body" class="cd-howto-body" style="display:none">',
        /* ★ 原来挂在面板顶部的常驻提示移到这里：下面已经有完整说明与图例，
           常驻两行只是重复占位（用户反馈：「这个是不是应该移到怎么看里」）。 */
        '          <div class="cd-hint">把「<code>名字·层 内容</code>」渲染成分镜式对话：'
        + '<b>颜色 = 角色</b>、<b>样式 = 层</b>、标签永不出现。</div>',
        '          <div class="cd-note"><b>颜色 = 角色</b>：同一个角色在整段对话里颜色一致；没钉过的按<b>出场顺序</b>依次拿 8 色调色板（用完按色相环自动生成）。</div>',
        '          <div class="cd-note"><b>左侧竖线 = 层</b>：' + esc(conv) + '</div>',
        legendHTML(),
        '          <div class="cd-sec-h">记号说明（会看到这几种特殊标记）</div>',
        '          <div class="cd-note">· <b>名字格下面有虚线</b> —— 这一行的名字（或层名）是<b>插件补的</b>：模型漏写、插件按依据补上，鼠标悬停有说明</div>',
        '          <div class="cd-note">· <b>左侧是虚线竖线</b> —— <b>自定义层</b>（你在下面「自定义层」里自己加的那种）</div>',
        '          <div class="cd-note">· <b>整行淡红 + 写着「格式错误」</b> —— 层名后漏了空格之类；到最下面「格式错误」区点 #号 能跳过去修</div>',
        '          <div class="cd-note">· <b>灰色的整段文字</b> —— 不是分镜行（思考块、散文、状态块…），插件<b>原样放过</b>，一个字不改</div>',
        '        </div>',
        '      </div>',
    ].join('');
}
function legendHTML() {
    const rows = [
        { who: '林野', layer: '动作', color: '#00F5EF', text: '我按住她的手腕。' },
        { who: '林婉婷', layer: '台词', color: '#D982EF', text: '「不脱。」' },
        { who: '林野', layer: '感官', color: '#00F5EF', text: '她的皮肤凉得发紧。' },
        { who: '林婉婷', layer: '心理', color: '#D982EF', text: '我在想，要不要说。' },
        { who: '', layer: '旁白', color: '', text: '灯灭了。' },
    ];
    const grid = rows.map(r => {
        if (r.layer === '旁白') {
            return '<div class="custom-cd-row custom-cd-L-narr" style="' + esc(layerVars('旁白', DEFAULT_CONFIG)) + '">'
                + '<span class="custom-cd-who"></span>'
                + '<span class="custom-cd-body">' + esc(r.text) + '</span></div>';
        }
        return '<div class="custom-cd-row ' + layerClass(r.layer) + '" style="--c:' + esc(r.color) + ';'
            + esc(layerVars(r.layer, DEFAULT_CONFIG)) + '">'
            + '<span class="custom-cd-who">' + esc(r.who) + '</span>'
            + '<span class="custom-cd-body">' + esc(r.text) + '</span></div>';
    }).join('');
    const conv = ['台词', '动作', '感官', '心理', '旁白'].map(L => {
        const st = DEFAULT_LAYER_STYLES[L] || {};
        const mk = (st.mark && st.mark !== 'none') ? (MARK_LABEL[st.mark] || st.mark) : '无竖线';
        return L + ' = ' + mk + (st.italic ? ' + 斜体' : '');
    }).join('　｜　');
    return '<div class="cd-legend">'
        + '<div class="cd-legend-t">图例 —— 聊天里实际长这样（下面是真渲染，不是图片）</div>'
        + '<div class="custom-cd-root"><div class="custom-cd-grid">' + grid + '</div></div>'
        + '<div class="cd-note">' + esc(conv) + '</div>'
        + '<div class="cd-note">左边一列 = 名字（颜色就是它的身份色）　·　名字右边那条竖线 = 层</div>'
        + '</div>';
}
function presetSecHTML() {
    return [
        '      <div class="cd-sec"><div class="cd-sec-h">专属预设（在你本机生成 · 插件不分发预设内容）</div>',
        /* 为什么不在这里堆作者名与许可全文：那是**查阅型**信息，每次开面板都念一遍只会占空间。
           署名该在的地方是**产物里**（derivedFrom + 停用的说明条目），这里只把用户指过去。 */
        '        <div class="cd-note">只带<b>配方</b>、不含预设内容：选你手上那份<b>原预设 JSON</b>，本机派生一份给你下载。',
        '          出处与许可会一并写进生成出来的预设里。</div>',
        '        <div class="cd-btn-row">',
        '          <button type="button" class="menu_button" id="cd-preset-pick">选择预设文件…</button>',
        '          <span class="cd-note" id="cd-preset-name">未选择</span>',
        '        </div>',
        /* ★ 隐藏原生输入框、用真按钮触发 —— 暗色主题下原生 file 控件几乎看不见，
           用户根本不知道要点哪（真机反馈：「怎么选文件」）。与「导入配置」同一套做法。 */
        '        <input type="file" id="cd-preset-file" accept=".json,application/json" class="cd-hidden">',
        '        <div class="cd-btn-row">',
        '          <button type="button" class="menu_button" id="cd-preset-dry">只看会改什么</button>',
        '          <button type="button" class="menu_button" id="cd-preset-make">生成专属预设</button>',
        '        </div>',
        '        <pre id="cd-preset-out" class="cd-heartbeat">（还没选文件 —— 先点上面的「选择预设文件…」）</pre>',
        '      </div>',
    ].join('');
}
/* ── 扩展信息 / 查看日志（对齐 card-compat 0.3.1 与 plot-pilot 0.1.3 的同一块）──
   为什么三个扩展都要有：ST 的抽屉里没有任何「作者 / 许可 / 我到底改了什么」的说明，
   而用户是在拿它动自己的聊天数据 —— 必须能一眼看到作者、许可与作用范围。 */
const REPO = 'https://github.com/Anarrogantcat/sillytavern-shell';
const CD_INFO_KEY = 'cd-info-open';
let changelogCache = null;
async function loadChangelog() {
    if (changelogCache) return changelogCache;
    try {
        const url = new URL('./CHANGELOG.md', import.meta.url).href;
        const res = await fetch(url, { cache: 'no-cache' });
        changelogCache = (res && res.ok) ? await res.text() : '';
    } catch (_) { changelogCache = ''; }
    return changelogCache;
}
/** 极简 markdown → HTML（只用得上标题 / 粗体 / 行内码 / 列表 / 链接） */
function mdToHtml(md) {
    const esc2 = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (t) => esc2(t)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return String(md).split(/\r?\n/).map(line => {
        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h) { const n = h[1].length + 1; return '<h' + n + '>' + esc2(h[2]) + '</h' + n + '>'; }
        const li = line.match(/^\s*[-*]\s+(.*)$/);
        if (li) return '<div class="cd-log-li">• ' + inline(li[1]) + '</div>';
        if (!line.trim()) return '<div class="cd-log-gap"></div>';
        return '<div>' + inline(line) + '</div>';
    }).join('');
}
async function showChangelog() {
    try {
        const md = await loadChangelog();
        const head = '<div class="cd-log-head"><b>🎞 分镜对话 Cine Dialogue</b> v' + VERSION
            + ' ｜ <a href="' + REPO + '/blob/main/extensions/cine-dialogue/CHANGELOG.md" target="_blank" rel="noopener">GitHub</a></div>';
        const body = md ? mdToHtml(md)
            : '<p>读不到 CHANGELOG.md（扩展目录里应当有一份，重新部署即可恢复）</p>';
        const html = '<div class="cd-log-doc">' + head + body + '</div>';
        /* ★ 用**全局** callGenericPopup —— 与 plot-pilot 一致；
           不从 script.js import，避免万一它不是导出时整个模块链接失败（0.1.0 踩过的坑）。 */
        if (typeof callGenericPopup === 'function' && typeof POPUP_TYPE !== 'undefined') {
            await callGenericPopup(html, POPUP_TYPE.TEXT, '', { okButton: '关闭', wide: true, large: true, allowVerticalScrolling: true });
            return;
        }
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); }
        else notify('打不开日志窗口（被浏览器拦了）', 'warning');
    } catch (e) { notify('打开日志失败：' + String((e && e.message) || e), 'warning'); }
}
/** 扩展信息卡默认折叠，只留一行「ⓘ 扩展信息」（折叠状态记在 localStorage） */
function applyInfoOpen() {
    try {
        const body = document.getElementById('cd-info-body');
        const tg = document.getElementById('cd-info-toggle');
        if (!body) return;
        let open = false;
        try { open = localStorage.getItem(CD_INFO_KEY) === '1'; } catch (_) { open = false; }
        body.style.display = open ? '' : 'none';
        if (tg) { tg.setAttribute('aria-expanded', open ? 'true' : 'false'); tg.textContent = (open ? '▾ ' : 'ⓘ ') + '扩展信息'; }
    } catch (_) { /* 折叠失败不影响使用 */ }
}
function infoSecHTML() {
    return [
        '      <div id="cd-info" class="cd-info">',
        '        <div id="cd-info-toggle" class="cd-info-toggle" role="button" tabindex="0">ⓘ 扩展信息</div>',
        '        <div id="cd-info-body" class="cd-info-body" style="display:none">',
        '          <div class="cd-info-name">🎞 <b>分镜对话</b> (Cine Dialogue) · Ver ' + esc(VERSION) + '</div>',
        '          <div class="cd-info-actions"><button type="button" class="menu_button" id="cd-info-log">查看日志</button></div>',
        '          <div class="cd-info-line">作者：小肥鱼（DeepSeek V4 Flash）· 染喵 ｜ 许可：AGPL-3.0 ｜ 项目主页：'
        + '<a href="' + REPO + '" target="_blank" rel="noopener">' + REPO + '</a></div>',
        '          <div class="cd-info-note">本扩展免费使用，禁止任何形式的商业用途。它只在<b>显示层</b>把「<code>名字·层 内容</code>」重排成分镜式对话（颜色 = 角色、样式 = 层），<b>不改聊天原文、不改 MVU 变量</b>；卡自己的前端块与状态栏不受影响。面板里的「安装专属正则」会往你的正则列表写 4 条（显示层专用，旁边有「移除专属正则」）。</div>',
        '        </div>',
        '      </div>',
    ].join('');
}
/** 面板分组：按 PANEL_GROUPS 把字段折成若干块（默认只展开「基本」） */
function groupsHTML(c) {
    const by = {};
    for (const f of PANEL_FIELDS) {
        if (!f.group) continue;      // group:null = 总开关，常驻顶部、不折叠
        (by[f.group] = by[f.group] || []).push(fieldHTML(f, c));
    }
    return PANEL_GROUPS.map(g => {
        const rows = by[g.name] || [];
        if (!rows.length) return '';
        return '<div class="cd-grp" data-cd-grp="' + esc(g.name) + '">'
            + '<div class="cd-grp-toggle" role="button" tabindex="0" aria-expanded="' + (g.open ? 'true' : 'false') + '" data-cd-grp-toggle="' + esc(g.name) + '">'
            + (g.open ? '▾ ' : '▸ ') + esc(g.name) + '</div>'
            + '<div class="cd-grp-body" data-cd-grp-body="' + esc(g.name) + '"' + (g.open ? '' : ' style="display:none"') + '>'
            + rows.join('') + '</div></div>';
    }).join('');
}
/** 总开关那一行：取 group 为空的字段（**常驻面板顶部**，不折叠） */
function masterHTML(c) {
    const f = PANEL_FIELDS.find(x => !x.group);
    if (!f) return '';
    return '<div class="cd-master">' + fieldHTML(f, c) + '</div>';
}

/**
 * 让 ST 重新渲染每一楼 —— 用来把**已经渲染过的楼层恢复原样**。
 * 关了总开关之后我们的钩子/降级路径都不再接管 ⇒ ST 按原文渲染 ⇒ 恢复 ✓
 * ★ 用 getContext() 拿函数，**不新增 import** —— 避免又一次 ESM 链接失败（0.1.0 的教训）。
 */
function restoreAllMessages() {
    try {
        const ctx = getContext();
        if (!ctx || typeof ctx.updateMessageBlock !== 'function') return 0;
        const chat = chatArr();
        let n = 0;
        document.querySelectorAll('#chat .mes').forEach(el => {
            const id = Number(el.getAttribute('mesid'));
            if (!Number.isFinite(id) || id < 0 || !chat[id]) return;
            try { ctx.updateMessageBlock(id, chat[id], { rerenderMessage: true }); n++; } catch (_) { /* 单楼失败不影响其它楼 */ }
        });
        return n;
    } catch (e) { console.warn('[' + EXT_ID + '] 恢复楼层失败（不影响其它功能）', e); return 0; }
}
/** 总开关的动作：启用 → 重渲染；停用 → 清注入 + 把已渲染楼层恢复原样 */
function applyMasterSwitch() {
    const on = !!cfg().enabled;
    applyPromptInjection();                 // 关掉时这里会把注入清空（见 use 判断）
    if (on) { schedule(true); notify('分镜对话已启用', 'success'); return; }
    const n = restoreAllMessages();
    notify(n ? ('分镜对话已停用，' + n + ' 个楼层已恢复原样') : '分镜对话已停用（当前没有可恢复的楼层）', 'info');
}

/*
 * 把面板里**手写的** `.cd-sec` 段统一变成可折叠（配色 / 层样式 / 自定义层 / 交互 / 这张卡·数据 /
 * 专属预设 / 格式错误 …）。
 *
 * ★ 为什么用 DOM 后处理而不是重写那堆 HTML：那些段的 innerHTML 是几十行字符串拼接，
 *   重写风险大、还容易漏；直接把「标题之后的兄弟节点」搬进一个 body 容器就行，
 *   id（#cd-colors / #cd-layers …）都不变，rebuildDynamic 照常找得到。
 */
function makeSectionsCollapsible() {
    const panel = document.getElementById('cd-panel');
    if (!panel) return 0;
    let n = 0;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('cd-sec-open') || '{}') || {}; } catch (_) { saved = {}; }
    for (const node of Array.from(panel.children)) {
        if (node.nodeType !== 1 || !node.classList.contains('cd-sec')) continue;
        if (node.getAttribute('data-cd-collapsed') === '1') continue;
        const head = node.querySelector(':scope > .cd-sec-h');
        if (!head) continue;
        const title = String(head.textContent || '').trim();
        const body = document.createElement('div');
        body.className = 'cd-grp-body';
        /* 把标题之后的兄弟节点全部搬进 body */
        let cur = head.nextSibling;
        while (cur) { const next = cur.nextSibling; body.appendChild(cur); cur = next; }
        const open = saved[title] === true;
        body.style.display = open ? '' : 'none';
        head.classList.add('cd-grp-toggle');
        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        head.setAttribute('data-cd-sec-toggle', title);
        head.textContent = (open ? '▾ ' : '▸ ') + title;
        node.appendChild(body);
        node.setAttribute('data-cd-collapsed', '1');
        n++;
    }
    return n;
}

function wireSectionToggles(panel) {
    if (!panel) return;
    panel.addEventListener('click', (ev) => {
        const head = ev.target && ev.target.closest ? ev.target.closest('[data-cd-sec-toggle]') : null;
        if (!head) return;
        const title = head.getAttribute('data-cd-sec-toggle');
        const body = head.parentElement ? head.parentElement.querySelector('.cd-grp-body') : null;
        if (!body) return;
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        head.textContent = (open ? '▾ ' : '▸ ') + title;
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('cd-sec-open') || '{}') || {}; } catch (_) { saved = {}; }
        saved[title] = open;
        try { localStorage.setItem('cd-sec-open', JSON.stringify(saved)); } catch (_) { /* 存不了只影响本次 */ }
    });
}

function buildSettingsPanel() {
    if (document.getElementById('cd-panel')) return;                 // 幂等
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) {
        console.warn('[' + EXT_ID + '] 找不到设置面板容器（#extensions_settings2 / #extensions_settings）→ 跳过抽屉');
        return;
    }

    const c = cfg();
    const rows = groupsHTML(c);

    host.insertAdjacentHTML('beforeend', [
        '<div class="inline-drawer">',
        '  <div class="inline-drawer-toggle inline-drawer-header">',
        '    <b>🎞 分镜对话 Cine Dialogue v' + esc(VERSION) + '</b>',
        '    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>',
        '  </div>',
        '  <div class="inline-drawer-content">',
        '    <div id="cd-panel">',
        howtoSecHTML(),

        masterHTML(c),

        rows,
        '      <div class="cd-btn-row">',
        '        <button type="button" class="menu_button" id="cd-refresh-all">立即重渲染全部</button>',
        '        <button type="button" class="menu_button" id="cd-regex-install">安装/更新专属正则</button>',
        '        <button type="button" class="menu_button" id="cd-regex-remove">移除专属正则</button>',
        '        <button type="button" class="menu_button" id="cd-diag">诊断信息</button>',
        '      </div>',
        '      <pre id="cd-hb" class="cd-heartbeat">点「诊断信息」看核内钩子接线状态 / 渲染计数</pre>',
        '      <div id="cd-regex-state" class="cd-note"></div>',

        /* ---- 配色（L6）---- */
        '      <div class="cd-sec"><div class="cd-sec-h">配色 —— 颜色 = 角色</div>',
        '<div class="cd-note">颜色 = 角色（分配规则与图例见最上方「ⓘ 怎么看」）。点取色器 = 钉死这个角色的颜色，钉死一个不会改变别人。</div>',
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
          '<button type="button" class="menu_button" id="cd-card-off">这张卡不生效（自带美化的卡用它）</button>',
        '          <button type="button" class="menu_button" id="cd-export">导出配置</button>',
        '          <button type="button" class="menu_button" id="cd-import">导入配置</button>',
        '          <button type="button" class="menu_button" id="cd-story">导出全部分镜 (Markdown)</button>',
        '        </div>',
        '        <input type="file" id="cd-file" accept=".json,application/json" class="cd-hidden">',
        '        <div id="cd-cardstate" class="cd-note"></div>',
        '      </div>',

        presetSecHTML(),

        /* ---- 格式错误面板（L6）---- */
        '      <div class="cd-sec"><div class="cd-sec-h">格式错误（模型写漏了「层名后的空格」之类）</div>',
        '        <div class="cd-btn-row"><button type="button" class="menu_button" id="cd-errs">刷新错误列表</button></div>',
        '        <div id="cd-errlist" class="cd-errlist"></div>',
        '      </div>',

        infoSecHTML(),

        '      </div>',
        '    </div>',
        '  </div>',
        '</div>',
    ].join('\n'));

    const p = document.getElementById('cd-panel');
    wirePanel();
    rebuildDynamic();
    /* ★ 手写段折叠化：必须在 rebuildDynamic 之后（那时 #cd-colors / #cd-layers 等都已填好） */
    wireSectionToggles(p);
    try { refreshRegexState(); } catch (e) { console.warn('[' + EXT_ID + '] 刷新正则状态失败（不影响使用）', e); }
    const collapsed = makeSectionsCollapsible();
    if (collapsed) console.log('[' + EXT_ID + '] 已把 ' + collapsed + ' 个面板段折叠化');
    applyInfoOpen();

    /* 让面板里的原生控件跟着主题走（否则某些主题下 input 是白底 + 浅色文字 = 看不见） */
    if (p && isLightTheme()) p.classList.add('cd-light');

    console.log('[' + EXT_ID + '] 设置抽屉已挂到 #' + host.id);
}

// ---------------------------------------------------------------- 启动

function start() {
    try { migrateColorStamp(); } catch (_) { }
    try { migrateRowGap(); } catch (_) { }
    try { migrateSeparators(); } catch (_) { }
    try { migrateRegexR23(); } catch (_) { }
    try { cdStartButtons({ getContext, effectiveConfig, hasOurLines, allLayers, parseLine, mergeSplitTags, renderMessageHTML, cardKey, cfg, saveSettingsDebounced, EXT_ID, cardHasFrontend }); } catch (_) { }
    /* ★★ 每一步单独兜错：任何一步失败都**不该让整个扩展哑掉**。
       这个坑踩过两次：
         · 0.1.0 —— extension_settings 从 script.js import → ESM 链接失败 → 一行都不执行
         · 0.7.2 —— 图例里用了没导入的 layerClass → buildSettingsPanel 抛错 → 抽屉消失
       两次的表现一模一样：**「扩展程序」列表里根本没有这个抽屉**，不看 F12 完全不知道哪错了。
       现在：失败的那一步记进 failedSteps，其余步骤照常跑，并在控制台 + 通知里说清是哪一步。 */
    const step = (name, fn) => {
        try { fn(); }
        catch (e) {
            const msg = name + '：' + ((e && e.message) ? e.message : String(e));
            failedSteps.push(msg);
            console.error('[' + EXT_ID + '] 启动步骤「' + name + '」失败（其余步骤继续）：', e);
        }
    };

    step('读配置', () => cfg());
    step('挂事件', () => bind());
    step('对外 API', () => exposeApi());
    step('交互（选项按钮/双击复制/跳场景）', () => bindInteractions());
    step('注入样式', () => { injectStyles(); });
    step('建设置面板', () => buildSettingsPanel());
    step('提示词注入', () => applyPromptInjection());
    step('斜杠命令', () => registerSlashCommand());

    if (failedSteps.length) {
        console.error('[' + EXT_ID + '] 有 ' + failedSteps.length + ' 个启动步骤失败：\n  ' + failedSteps.join('\n  '));
        try { notify('分镜对话：' + failedSteps.length + ' 个启动步骤失败（按 F12 看控制台）', 'error'); } catch (_) { /* 没有 toastr 就只打控制台 */ }
    }

    console.log('[' + EXT_ID + '] v' + VERSION + ' loaded'
        + '  TavernHelper=' + (TH() ? 'yes' : 'no')
        + '  Mvu=' + (MVU() ? 'yes' : 'no')
        + '  CardCompat=' + (CC() ? 'yes' : 'no')
        + '  PlotPilot=' + (PP() ? 'yes' : 'no')
        + (failedSteps.length ? ('  ⚠ 失败步骤=' + failedSteps.length) : ''));
    try { schedule(true); } catch (e) { console.error('[' + EXT_ID + '] 首次渲染调度失败：', e); }
}

// ST 启动时扩展可能早于聊天加载完 → 两个时机都试
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(start, 0);
} else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
}
