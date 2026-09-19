// logic.js — 纯函数层（不依赖 ST/DOM，可被 Node 单测）
// 职责：从角色卡的正则脚本推导「锚点标签族 / 数据块标签族 / 隐藏目标」，并对消息文本做守护

const TAG_RE = /<\/?([A-Za-z][A-Za-z0-9_!-]*)\s*\/?>/g;
const HIDE_RE = /隐藏|删除|去除|hide|remove|strip/i;
const DATA_RE = /UpdateVariable|变量/i;

export function tagsOf(text) {
    const out = new Set();
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(String(text || '')))) out.add(m[1].replace(/\/$/, ''));
    return [...out];
}

/**
 * 由角色卡的 extensions 推导守护档案
 * @param {object} ext 角色卡 data.extensions
 */
export function buildProfile(ext) {
    const scripts = (ext?.regex_scripts || []).filter(s => !s.disabled);
    const anchors = new Set();
    const dataTags = new Set();
    const hideTargets = new Set();
    for (const s of (ext?.regex_scripts || [])) {
        const isHide = HIDE_RE.test(String(s.scriptName || ''));
        for (const tag of tagsOf(s.findRegex)) {
            if (DATA_RE.test(tag)) dataTags.add(tag);
            else if (isHide) hideTargets.add(tag);
            else anchors.add(tag);
        }
    }
    const helpers = ext?.tavern_helper?.scripts || [];
    const helperText = helpers.map(s => String(s.content || '')).join('\n');
    return {
        anchors: [...anchors],
        dataTags: [...dataTags],
        hideTargets: [...hideTargets],
        helperCount: helpers.length,
        helperRenders: helpers.length > 0 && /状态栏|StatusPlaceHolder|StatusBar/i.test(helperText),
        // 卡自己会隐藏的锚点不要补（补了反而多出面板）
        injectableAnchors: [...anchors].filter(t => !hideTargets.has(t)),
    };
}

/** 找未闭合的块：返回 [{tag, kind:'open-missing-close'}] */
export function findUnclosed(text, tags) {
    const out = [];
    for (const tag of tags) {
        const open = new RegExp('<' + tag + '(?:\\s[^>]*)?>', 'g');
        const close = new RegExp('</' + tag + '>', 'g');
        const opens = (text.match(open) || []).length;
        const closes = (text.match(close) || []).length;
        if (opens > closes) out.push({ tag, missing: opens - closes });
    }
    return out;
}

/**
 * 守护主函数（纯函数，便于单测）
 * @returns {{text:string, actions:Array<{type:string,tag:string,detail?:string}>}}
 */
export function guardText(text, profile, opts = {}) {
    const actions = [];
    let out = String(text ?? '');
    if (!out) return { text: out, actions };

    // 1) 数据块：绝不改动内容，只在「开标签存在但未闭合」时补结束标签
    for (const tag of profile.dataTags || []) {
        const opened = out.includes('<' + tag);
        const closed = out.includes('</' + tag + '>');
        if (opened && !closed && opts.repairClosure !== false) {
            out = out.trimEnd() + '\n</' + tag + '>';
            actions.push({ type: 'data-close-repaired', tag });
        } else if (!opened) {
            actions.push({ type: 'data-missing', tag });
        }
    }

    // 2) 锚点：缺失时按设置补；未闭合时补闭合。绝不碰 hideTargets
    const hide = new Set(profile.hideTargets || []);
    for (const tag of profile.anchors || []) {
        if (hide.has(tag)) continue;
        const selfClosing = new RegExp('<' + tag + '\\s*/>');
        const opened = out.includes('<' + tag);
        const closed = out.includes('</' + tag + '>');
        if (selfClosing.test(out)) continue;
        if (opened && !closed && opts.repairClosure !== false) {
            out = out.trimEnd() + '\n</' + tag + '>';
            actions.push({ type: 'anchor-close-repaired', tag });
            continue;
        }
        if (!opened && opts.injectAnchor) {
            out = out.trimEnd() + (opts.anchorStyle === 'self' ? '\n<' + tag + '/>' : '\n<' + tag + '></' + tag + '>');
            actions.push({ type: 'anchor-injected', tag });
        } else if (!opened) {
            actions.push({ type: 'anchor-missing', tag });
        }
    }
    return { text: out, actions };
}

/** 数据新鲜度：从文本里抠出可比较的字段（第N天 / 日期 / 时刻 / 地点 / 天气） */
export function freshnessFields(text) {
    const t = String(text || '');
    const day = (t.match(/第\s*(\d+)\s*天/) || [])[1] || null;
    const date = (t.match(/(\d{4})\s*[-年]\s*(\d{1,2})\s*[-月]\s*(\d{1,2})/) || []).slice(1, 4).join('-') || null;
    const time = (t.match(/(\d{1,2})\s*[:：]\s*(\d{2})/) || []).slice(1, 3).join(':') || null;
    // 字段可能被空格/表格分隔在同一行 → 用「下一个标签或连续空格/行尾」做边界
    const grab = (label, max) => {
        const re = new RegExp(label + '\\s*[:：]\\s*(.{1,' + max + '}?)(?=\\s{2,}|\\s*(?:地点|天气|时间|时刻|日期|第\\s*\\d+\\s*天)[:：]?|$)', 's');
        const m = t.match(re);
        return m ? m[1].replace(/[|｜]\s*$/, '').trim() || null : null;
    };
    const place = grab('地点', 24);
    const weather = grab('天气', 12);
    return { day, date, time, place, weather };
}

/** 连续两轮字段是否完全一致（用于「数据疑似未更新」告警） */
export function isStale(prevText, curText) {
    if (!prevText || !curText) return { stale: false, reason: 'no-prev' };
    const a = freshnessFields(prevText), b = freshnessFields(curText);
    const keys = ['day', 'date', 'time', 'place', 'weather'].filter(k => a[k] && b[k]);
    if (!keys.length) return { stale: false, reason: 'no-fields' };
    const same = keys.filter(k => a[k] === b[k]);
    return { stale: same.length === keys.length, compared: keys.length, same: same.length, fields: { prev: a, cur: b } };
}
