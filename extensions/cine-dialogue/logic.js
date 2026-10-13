// 作者：小肥鱼 (DeepSeek) · 染喵 ｜ 许可：AGPL-3.0 ｜ 项目：https://github.com/Anarrogantcat/sillytavern-shell
// logic.js — 分镜对话 Cine Dialogue · 纯逻辑层
//
/**
 * 分镜对话 · 纯函数层
 *
 * 本文件**不碰 DOM、不碰 ST** —— 只做「文本 → 数据 → HTML 字符串」。
 * 所有函数都可以在 Node 里直接跑夹具（scripts/cine-dialogue-test.mjs）。
 *
 * 契约（插件只认这些，其余一律不碰）：
 *   一行 名字·层 内容      层 = 台词/动作/感官/心理（层后必须一个空格）
 *   一行 旁白·内容         旁白没有名字字段
 *   [FRONTEND] … [/FRONTEND]   整段跳过
 *   [OPTIONS] … [/OPTIONS]     解析成选项
 *   其它任何内容               原样保留
 */

export const VERSION = '0.1.0';
export const EXT_ID = 'cine-dialogue';

/** 五种层 */
export const LAYERS = ['台词', '动作', '感官', '心理', '旁白'];

/** 层 → CSS 类（cd- 前缀，符合 AGENTS §0.3.2） */
export const LAYER_CLS = {
    '台词': 'cd-L-speech',
    '动作': 'cd-L-act',
    '感官': 'cd-L-sense',
    '心理': 'cd-L-mind',
    '旁白': 'cd-L-narr',
};

/** 默认调色板（颜色 = 角色，按出现顺序分配） */
export const PALETTE = [
    '#00F5EF', '#D982EF', '#E8C815', '#7FB2FF',
    '#FF8C42', '#B6E86B', '#FF6B9D', '#B48CFF',
];

export const DEFAULT_CONFIG = {
    enabled: true,
    /** 用户楼要不要也渲染（默认否 —— 用户打的是大白话，不是分镜格式） */
    transformUserMessages: false,
    /** auto=按最长名字 | left | right | fixed */
    nameColMode: 'auto',
    /** nameColMode=fixed 时的像素宽 */
    nameColWidth: 96,
    /** 行间距（em） */
    rowGap: 0.8,
    /** 首行缩进（em） */
    leadIndent: 2,
    /** 只给「真的换行」的段落做缩进 */
    indentOnlyWrapped: true,
    /** 格式错的行要不要标红 */
    markErrors: true,
    /** 自定义调色板（空 = 用 PALETTE） */
    palette: [],
    /** 层样式覆盖（留空 = 用 style.css 的默认） */
    layerStyles: {},
};

// ---------------------------------------------------------------- 基础

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML 转义（含引号 —— 会被塞进属性里） */
export function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ENT[c]);
}

// ---------------------------------------------------------------- 正则

/** 名字·层 内容 —— 层后**强制一个空格**，写漏了就走 other 分支 */
export const RE_ROW = /^([^\s·・:：]{1,12})\s*[·・:：]\s*(台词|动作|感官|心理)\s+(.+)$/;

/** 旁白·内容 —— 没有名字字段 */
export const RE_NARR = /^旁白\s*[·・:：]\s*(.+)$/;

/** 选项行：1. 文本 | 备注 */
export const RE_OPT = /^(\d+)[.、)]\s*(.+?)\s*(?:\|\s*(.*))?$/;

/** 标记区 */
export const RE_FRONTEND_BLOCK = /\[FRONTEND\]([\s\S]*?)\[\/FRONTEND\]/g;
export const RE_OPTIONS_BLOCK = /\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/g;

// ---------------------------------------------------------------- 解析

/**
 * 解析一行
 * @returns {{kind:'row',name:string,layer:string,text:string}
 *         | {kind:'narr',body:string}
 *         | {kind:'other',raw:string}}
 */
export function parseLine(line) {
    const n = line.match(RE_NARR);
    if (n) return { kind: 'narr', body: n[1].trim() };

    const r = line.match(RE_ROW);
    if (r) return { kind: 'row', name: r[1].trim(), layer: r[2], text: r[3].trim() };

    return { kind: 'other', raw: line };
}

/** 这行是不是「我们的行」 */
export function isOurLine(line) {
    const p = parseLine(line);
    return p.kind === 'row' || p.kind === 'narr';
}

/**
 * 从消息原文里切出三段：[FRONTEND] / [OPTIONS] / 正文
 * 切掉的标记区**不进正文**，由调用方决定怎么安置。
 */
export function splitSections(raw) {
    const text = String(raw == null ? '' : raw);

    const frontend = [];
    let rest = text.replace(RE_FRONTEND_BLOCK, (_m, inner) => {
        frontend.push(inner);
        return '\n';
    });

    const optionsRaw = [];
    rest = rest.replace(RE_OPTIONS_BLOCK, (_m, inner) => {
        optionsRaw.push(inner);
        return '\n';
    });

    const options = [];
    for (const block of optionsRaw) {
        for (const line of block.split('\n')) {
            const m = line.trim().match(RE_OPT);
            if (m) options.push({ index: m[1], text: m[2].trim(), note: (m[3] || '').trim() });
        }
    }

    return { body: rest, frontend, options };
}

/**
 * 正文 → 段落分组
 * 空行分段；每组是若干「行对象」；不匹配的行保留为 other（原样输出）
 */
export function parseBlocks(body) {
    const groups = [];
    let cur = [];
    let errs = 0;

    for (const rawLine of String(body == null ? '' : body).split('\n')) {
        const line = rawLine.trim();
        if (line === '') {
            if (cur.length) { groups.push(cur); cur = []; }
            continue;
        }
        const p = parseLine(line);
        if (p.kind === 'other') errs++;
        cur.push(p);
    }
    if (cur.length) groups.push(cur);

    return { groups, errs };
}

/** 按出现顺序收集角色名（不含旁白） */
export function collectNames(groups) {
    const out = [];
    const seen = new Set();
    for (const g of groups) {
        for (const r of g) {
            if (r.kind === 'row' && !seen.has(r.name)) { seen.add(r.name); out.push(r.name); }
        }
    }
    return out;
}

// ---------------------------------------------------------------- 颜色

/**
 * 给名字分配颜色（**纯函数**：给了 seed 就固定，不给就新建）
 * @param {string[]} names 按出现顺序的唯一名字
 * @param {object} seed   已有的 {name: color}（会原样保留）
 * @param {string[]} palette
 * @returns {object} 新的 {name: color}
 */
export function assignColors(names, seed = {}, palette = PALETTE) {
    const pal = (palette && palette.length) ? palette : PALETTE;
    const map = { ...seed };
    for (const n of names) {
        if (map[n]) continue;
        const i = Object.keys(map).length;
        map[n] = i < pal.length
            ? pal[i]
            : 'hsl(' + ((i * 137.508) % 360).toFixed(0) + ', 78%, 66%)';
    }
    return map;
}

// ---------------------------------------------------------------- 渲染

function rowHTML(r, colorMap, config) {
    if (r.kind === 'narr') {
        return '<div class="cd-row cd-L-narr">'
            + '<span class="cd-who"></span>'
            + '<span class="cd-body">' + esc(r.body) + '</span>'
            + '</div>';
    }
    if (r.kind === 'row') {
        const c = colorMap[r.name] || PALETTE[0];
        return '<div class="cd-row ' + LAYER_CLS[r.layer] + '" style="--c:' + esc(c) + '">'
            + '<span class="cd-who">' + esc(r.name) + '</span>'
            + '<span class="cd-body">' + esc(r.text) + '</span>'
            + '</div>';
    }
    // other：格式不对的行 —— 显式暴露，不静默降级
    if (!config.markErrors) return '';
    return '<div class="cd-row cd-err">'
        + '<span class="cd-who">格式错误</span>'
        + '<span class="cd-body">' + esc(r.raw) + '</span>'
        + '</div>';
}

/**
 * 分组 → 网格 HTML（**一条消息一个网格**，名字列宽整条统一）
 */
export function renderGrid(groups, colorMap = {}, config = DEFAULT_CONFIG) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const style = '--cd-gap:' + Number(cfg.rowGap) + 'em;'
        + '--cd-indent:' + Number(cfg.leadIndent) + 'em;';
    const mode = cfg.nameColMode === 'fixed' ? 'fixed' : 'auto';
    const fixed = mode === 'fixed' ? ' style="--cd-namew:' + Number(cfg.nameColWidth) + 'px"' : '';

    const rowsHTML = groups.map((g, gi) =>
        (gi > 0 ? '<div class="cd-sep"></div>' : '') + g.map(r => rowHTML(r, colorMap, cfg)).join('')
    ).join('');

    return '<div class="cd-root' + (mode === 'fixed' ? ' cd-fixed' : '') + '"'
        + fixed + ' style="' + style + '">'
        + '<div class="cd-grid">' + rowsHTML + '</div>'
        + '</div>';
}

/** 选项区 HTML */
export function renderOptions(options, config = DEFAULT_CONFIG) {
    if (!options || !options.length) return '';
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const btns = options.map(o =>
        '<button type="button" class="cd-opt" data-cd-text="' + esc(o.text) + '">'
        + '<span class="cd-opt-i">' + esc(o.index) + '.</span>'
        + '<span class="cd-opt-t">' + esc(o.text) + '</span>'
        + (o.note ? '<span class="cd-opt-n">' + esc(o.note) + '</span>' : '')
        + '</button>'
    ).join('');
    return '<div class="cd-options">' + btns + '</div>';
}

/** 总入口：正文 → 完整 HTML（不含 frontend —— 那块由 index.js 搬 DOM 节点） */
export function renderMessage(body, colorMap = {}, config = DEFAULT_CONFIG) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const { groups, errs } = parseBlocks(body);
    const names = collectNames(groups);
    const map = assignColors(names, colorMap, cfg.palette);

    /* 一条「我们的行」都没有 → 什么都不产出（调用方据此决定不碰 DOM）。
       注意判据不能只看 names.length：整条都是散文时 names=[] 但 errs>0，
       那样会把一条普通消息整条刷成红色「格式错误」。 */
    const hasAny = groups.some(g => g.some(r => r.kind === 'row' || r.kind === 'narr'));
    if (!hasAny) return { html: null, groups, errs, names, colors: map };

    return { html: renderGrid(groups, map, cfg), groups, errs, names, colors: map };
}

/** 一条消息里有没有「我们的行」（用来决定碰不碰它） */
export function hasOurLines(body) {
    for (const line of String(body == null ? '' : body).split('\n')) {
        const t = line.trim();
        if (t && isOurLine(t)) return true;
    }
    return false;
}

/** 统计（面板/排障用） */
export function stats() {
    return { version: VERSION, layers: LAYERS.slice(), palette: PALETTE.slice() };
}
