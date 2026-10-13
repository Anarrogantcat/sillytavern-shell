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
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from '../../../../script.js';

import { getContext } from '../../../extensions.js';

import {
    EXT_ID,
    VERSION,
    DEFAULT_CONFIG,
    PANEL_FIELDS,
    FORMAT_SPEC,
    REGEX_DEFS,
    SLASH_COMMAND,
    assignColors,
    esc,
    hasOurLines,
    isOurLine,
    renderMessage,
    renderMessageHTML,
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
        const c = cfg();
        if (!c.enabled) return mes;
        if (ctx && ctx.isSystem) return mes;
        if (ctx && ctx.isUser && !c.transformUserMessages) return mes;
        if (!hasOurLines(mes)) return mes;                        // 没有我们的行 → 一个字不改

        const mid = (ctx && Number.isFinite(Number(ctx.messageId))) ? Number(ctx.messageId) : -1;
        const res = renderMessageHTML(mes, colorMap[mid] || {}, c);
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

/** 装饰层：只做「必须看渲染结果才能做」的两件小事
 *   ① 整楼名字列宽统一（出现多个 .cd-root 时才需要）
 *   ② 首行缩进只给「真的换行」的段落
 *  ★ 这两件**两条路径下都要跑** —— 自检发现：钩子路径曾因 run() 一退到底而整片丢失。 */
function decorate(mesEl) {
    try { unifyNameColumn(mesEl); } catch (_) { /* 装饰失败不影响渲染 */ }
    try { applyIndent(mesEl); } catch (_) { /* 同上 */ }
}

function run(all) {
    const list = all
        ? Array.from(document.querySelectorAll('#chat .mes'))
        : Array.from(document.querySelectorAll('#chat .mes')).slice(-3);   // 只处理最近三楼

    const hooked = hookActive();

    for (const mesEl of list) {
        const mesId = Number(mesEl.getAttribute('mesid'));
        if (!Number.isFinite(mesId) || mesId < 0) continue;
        try {
            /* 核内钩子已渲染好了 → 只补装饰，不再解析 DOM
               （钩子的输出里已不含标签，重解析等于白跑，还会把成果再包一层） */
            if (hooked) { decorate(mesEl); continue; }

            const r = transformMessage(mesEl, mesId);
            if (r.ok) decorate(mesEl);
        } catch (e) {
            console.error('[' + EXT_ID + '] render failed, mes=' + mesId, e);
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
    const unit = f.unit ? ' ' + f.unit : '';
    const when = f.when ? '（' + esc(f.when) + ' 时生效）' : '';
    return '<div class="cd-line">' + lab
        + '<input type="number" data-cd-key="' + key + '" value="' + esc(c[f.key]) + '"'
        + ' min="' + esc(f.min) + '" max="' + esc(f.max) + '" step="' + esc(f.step) + '">'
        + '<span class="cd-note">' + esc(unit) + esc(when) + '</span></div>';
}

function wirePanel() {
    const panel = document.getElementById('cd-panel');
    if (!panel) return;

    panel.querySelectorAll('[data-cd-key]').forEach(el => {
        el.addEventListener('change', () => {
            const key = el.getAttribute('data-cd-key');
            if (!key || !(key in DEFAULT_CONFIG)) return;
            const type = el.getAttribute('type');
            const v = (type === 'checkbox') ? el.checked
                : (el.tagName === 'SELECT') ? el.value
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
                pre.textContent = JSON.stringify(window.CineDialogue ? window.CineDialogue.stats() : {}, null, 2);
            } catch (e) {
                pre.textContent = '诊断失败：' + (e && e.message ? e.message : String(e));
            }
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
        '    </div>',
        '  </div>',
        '</div>',
    ].join('\n'));

    wirePanel();
    console.log('[' + EXT_ID + '] 设置抽屉已挂到 #' + host.id);
}

// ---------------------------------------------------------------- 启动

function start() {
    cfg();
    bind();
    exposeApi();
    buildSettingsPanel();
    applyPromptInjection();
    registerSlashCommand();
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
