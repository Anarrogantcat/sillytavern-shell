// 作者：小肥鱼（DeepSeek V4 Flash）· 染喵 ｜ 许可：AGPL-3.0 ｜ 项目：https://github.com/Anarrogantcat/sillytavern-shell
// logic.js — 纯函数层（不依赖 ST/DOM，可被 Node 单测）
// 职责：从角色卡的正则脚本推导「锚点标签族 / 数据块标签族 / 隐藏目标」，并对消息文本做守护

const TAG_RE = /<\/?([A-Za-z][A-Za-z0-9_!-]*)\s*\/?>/g;
const HIDE_RE = /隐藏|删除|去除|hide|remove|strip/i;
// 数据块标签族（0.6.0：锚定 + 忽略大小写，并认下 <update> / <JSONPatch> 这类现代写法）
const DATA_RE = /^(?:update(?:variable)?|jsonpatch|变量)/i;
// 通用 HTML 标签：宽松抽取时排除，免得把界面代码里的 <div>/<script> 当成角色卡的锚点
const HTML_TAGS = new Set(['a', 'area', 'audio', 'b', 'base', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu', 'meta', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'svg', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'defs', 'use', 'text', 'tspan', 'stop', 'clippath', 'mask', 'pattern', 'symbol', 'marker', 'filter']);

/** 宽松标签抽取：允许中文标签名（卡的格式标签常见形如 <正文>、<女主A_名字>），用于「本卡声明了哪些标签」 */
export function broadTagsOf(text) {
    const out = new Set();
    const re = /<(\/?)([^\s<>/]{1,40})\s*(\/?)>/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
        const name = m[2];
        // 允许 ~ ! - 等杂字符（实测模型会写出 <konatan_planning~> 这种），只要不是纯符号即可
        // 0.6.0：名字收紧为「字母/数字/_/-/~/!/./中文」—— 旧写法会把 JS 片段当成标签名
        // （实测病灶：StatusPlaceHolderImpl\ g,'&lt;').replace( 被当成一个「格式标签」，于是每轮都误报「格式标签缺」）
        if (/^[A-Za-z\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5.~!-]{0,39}$/.test(name)) out.add(name);
    }
    return [...out];
}

/** 永远不清理的块：预设/插件已知块 + 通用 HTML（模型按预设 NyPigment 生成的界面就靠它们渲染） */
export const KEEP_BLOCKS = new Set([
    'tucao', 'think', 'thinking', 'analysis', 'analysis_zh', 'current_event', 'progress', 'options', 'option',
    'htmlcontent', 'style', 'script', 'div', 'span', 'p', 'br', 'hr', 'b', 'i', 'u', 's', 'em', 'strong', 'small',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'img', 'svg', 'path', 'g', 'circle', 'rect',
    'details', 'summary', 'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'font', 'center', 'iframe',
    'ruby', 'rt', 'rp', 'mark', 'del', 'ins', 'sub', 'sup', 'video', 'audio', 'source', 'canvas', 'label', 'input', 'button',
    // 0.8.1：变量协议自己的内部标签永不清理 —— 实测 P0：
    // <UpdateVariable>…<JSONPatch>[…]</JSONPatch>…</UpdateVariable> 里的 JSONPatch 往往没被单独声明，
    // 旧实现把整段补丁当「未声明块」删掉 → MVU 变量更新静默失效（91 张卡里 67 张会中招）
    'jsonpatch', 'json_patch', 'updatevariable', 'update_variable', 'variable_update', 'stat_data',
]);

/**
 * 清理「本卡没声明、也没人渲染」的结构块 —— 实测病灶：
 *   模型把世界书原文回显成 <world_setting>…</world_setting>（整段设定铺在聊天里），
 *   或自创 <status_block>、<konatan_planning~> 之类的块；卡的渲染正则不认它们 → 原文裸露、还顺带把版面撑爆。
 * 规则：只处理**成对**块；标签必须不在 declared（卡的 findRegex / 酒馆助手脚本里出现过）也不在 KEEP_BLOCKS；
 *       不成对（只有开标签）→ 只报告不删（避免误伤半截 HTML）。
 * @returns {{text:string, removed:Array<{tag,chars}>, unclosed:string[]}}
 */
export function stripUndeclaredBlocks(text, opts = {}) {
    let out = String(text ?? '');
    const declared = new Set(opts.declared || []);
    const keep = opts.keep || KEEP_BLOCKS;
    const removed = [];
    const unclosed = [];
    const names = [...new Set(broadTagsOf(out))];
    // 0.8.1：先算出「本卡声明过 / 永不清理」的成对块占据的区间 —— 落在这里面的子块一律不碰。
    // 实测 P0：<UpdateVariable>…<JSONPatch>[…]</JSONPatch>…</UpdateVariable> 里 JSONPatch 常常没被单独声明，
    //         旧实现会把整段补丁当「未声明块」删掉，MVU 变量更新静默失效（91 张卡里 67 张中招）。
    const protectSpans = () => {
        const spans = [];
        const all = new Set([...declared, ...[...keep].map((x) => String(x).toLowerCase())]);
        for (const t of all) {
            if (!t) continue;
            const e = escTag(t);
            const re = new RegExp('<' + e + '(?:\\s[^>]*)?>[\\s\\S]*?</' + e + '\\s*>', 'gi');
            let m;
            while ((m = re.exec(out))) spans.push({ a: m.index, b: m.index + m[0].length });
        }
        return spans;
    };
    let spans = protectSpans();
    const insideProtected = (i) => spans.some((s) => i >= s.a && i < s.b);
    for (const name of names) {
        if (declared.has(name) || keep.has(name) || keep.has(name.toLowerCase())) continue;
        // 转义正则元字符：只保留字母/数字/下划线/汉字，其余一律加反斜杠（用 fromCharCode 免得层层转义写错）
        const esc = String(name).split('').map((ch) => { const c = ch.codePointAt(0); return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 0x2e80 ? ch : String.fromCharCode(92) + ch; }).join('');
        const anyRe = new RegExp('<' + esc + '(?:\\s[^>]*)?>', 'g');
        const occ = [];
        let mo;
        while ((mo = anyRe.exec(out))) occ.push(mo.index);
        if (!occ.length) continue;
        if (occ.every((i) => insideProtected(i))) continue;   // 整个标签都活在本卡的协议块里 → 不删也不报
        const pairRe = new RegExp('<' + esc + '(?:\\s[^>]*)?>[\\s\\S]*?</' + esc + '\\s*>', 'g');
        const hits = [];
        let mp;
        while ((mp = pairRe.exec(out))) hits.push({ a: mp.index, b: mp.index + mp[0].length });
        const removable = hits.filter((h) => !insideProtected(h.a));
        if (removable.length) {
            for (const h of removable) removed.push({ tag: name, chars: h.b - h.a });
            for (const h of removable.slice().sort((x, y) => y.a - x.a)) out = out.slice(0, h.a) + out.slice(h.b);
            spans = protectSpans();
            continue;
        }
        if (hits.length) continue;                             // 有成对的（哪怕全在保护区里）就不报「只有开标签」
        if (new RegExp('<' + esc + '(?:\\s[^>]*)?>').test(out)) unclosed.push(name);
    }
    return { text: out, removed, unclosed };
}

/** 正则转义（标签名里可能有 status! 这类元字符） */
function escTag(name) {
    return String(name ?? '').replace(/[.*+?^{}()|[\]\\$]/g, '\\$&');
}

/** 变量路径归一：点号分隔 → 斜杠开头；去掉空白与多余斜杠；保留末段通配 * */
export function normalizePath(raw) {
    let p = String(raw ?? '').trim().replace(/^["']|["']$/g, '');
    p = p.split('.').join('/').split('｜').join('/');
    p = p.replace(/\/{2,}/g, '/').replace(/\s+/g, '');
    if (!p) return '';
    if (p.charAt(0) !== '/') p = '/' + p;
    return p.replace(/\/$/, '');
}

const D = String.fromCharCode(36);   // 美元符常量：拼正则用，避免源码里出现模板组起始标记
const TPL_RE = new RegExp('\\' + D + '\\{([^}]+)\\}');

/**
 * 展开「模板组」：一条规则里可以出现多组，组名/字段名/路径段都可能带
 *   系统.模板组(日期|时间) → 系统.日期 / 系统.时间
 * @returns {string[]} 去重后的展开结果（保序）
 */
export function expandTemplateGroups(values, maxRounds = 8) {
    let pool = (values || []).map((v) => String(v ?? ''));
    for (let round = 0; round < (Number(maxRounds) || 8); round++) {
        let changed = false;
        const next = [];
        for (const v of pool) {
            const mm = TPL_RE.exec(v);
            if (!mm) { next.push(v); continue; }
            changed = true;
            for (const alt of mm[1].split(/[|｜]/)) next.push(v.slice(0, mm.index) + alt.trim() + v.slice(mm.index + mm[0].length));
        }
        pool = next;
        if (!changed) break;
    }
    return [...new Set(pool)];
}

/** 抽出补丁里的 JSONPatch 数组（支持一条回复里的多个 <JSONPatch> 片段） */
export function parsePatchOps(blockOrPatch) {
    const raw = String(blockOrPatch || '');
    const problems = [];
    const openTag = '<JSONPatch>', closeTag = '</JSONPatch>';
    const frags = [];
    let i = 0;
    while (true) {
        const a = raw.indexOf(openTag, i);
        if (a < 0) break;
        const b = raw.indexOf(closeTag, a);
        if (b < 0) { frags.push(raw.slice(a + openTag.length)); break; }
        frags.push(raw.slice(a + openTag.length, b));
        i = b + closeTag.length;
    }
    if (!frags.length) frags.push(raw);
    const ops = [];
    for (const frag of frags) {
        let t = String(frag);
        const o = t.indexOf('['), c = t.lastIndexOf(']');
        if (o >= 0 && c > o) t = t.slice(o, c + 1);
        t = t.trim();
        if (!t) continue;
        let arr = null;
        try { arr = JSON.parse(t); } catch (e) { problems.push('JSON 解析失败: ' + String((e && e.message) || e).slice(0, 80)); continue; }
        if (!Array.isArray(arr)) { problems.push('不是数组'); continue; }
        for (const el of arr) {
            if (!el || typeof el !== 'object') { problems.push('元素不是对象'); continue; }
            ops.push(el);
        }
    }
    return { ops, problems, frags: frags.length };
}

/** 抽出一条回复里的全部变量块（多块记账用；extractUpdateBlock 仍只返回第一个） */
export function extractUpdateBlocks(text) {
    const s = String(text || '');
    const out = [];
    let i = 0;
    while (true) {
        const a = s.indexOf('<UpdateVariable', i);
        if (a < 0) break;
        const gt = s.indexOf('>', a);
        if (gt < 0) break;
        const b = s.indexOf('</UpdateVariable>', gt);
        if (b < 0) { out.push({ block: s.slice(a), patchText: '' }); break; }
        const block = s.slice(a, b + '</UpdateVariable>'.length);
        const pa = block.indexOf('<JSONPatch>'), pb = block.indexOf('</JSONPatch>');
        out.push({ block: block, patchText: (pa >= 0 && pb > pa) ? block.slice(pa + '<JSONPatch>'.length, pb).trim() : '' });
        i = b + '</UpdateVariable>'.length;
    }
    return out;
}

/**
 * 从角色卡世界书条目里抽出变量路径白名单
 *   ① 缩进结构（复用 extractRequiredFields，含模板组展开）
 *   ② 规则正文里显式写出的 /路径
 *   ③ 示例代码：_.set('角色.好感', 1)、{"path":"/角色/好感"}、路径: /角色/好感
 * @returns {{paths:string[], prefixes:string[], wildcards:string[], all:string[]}}
 */
export function extractAllowedPaths(entries, opts = {}) {
    const limit = Number(opts.limit) || 400;
    const list = [];
    const seen = new Set();
    const add = (raw) => {
        const s = String(raw || '');
        if (/[(),?$*]/.test(s)) return;            // 反引号里的代码/参数不算路径
        if (!/[.\/]/.test(s)) return;
        const q = normalizePath(s);
        if (!q || q === '/') return;
        if (seen.has(q)) return;
        seen.add(q);
        list.push(q);
    };
    const entryText = (entries || []).map((e) => String(e?.content || '')).join('\n');
    try { for (const f of extractRequiredFields(entries, Math.min(limit, 200))) add(f.path); } catch (_) {}
    for (const re of [
        /_\s*\.\s*set\s*\(\s*['"]([^'"]{1,80})['"]/g,
        /["']path["']\s*:\s*["']([^"']{1,80})["']/g,
        /路径\s*[:：]\s*([^\s，。；,;]{1,80})/g,
        /(?:^|[\s\-*（(,，])[/]([A-Za-z\u4e00-\u9fa5][^\s，。；、,;）)<>"']{0,60})/gm,
        /[\x60]([A-Za-z\u4e00-\u9fa5][A-Za-z0-9_.\u4e00-\u9fa5-]{1,60})[\x60]/g,
    ]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(entryText))) add(m[1]);
    }
    const wildcards = list.filter((q) => q.indexOf('*') >= 0);
    const prefixes = [];
    const pset = new Set();
    for (const q of list) {
        const parts = q.split('/').filter(Boolean);
        for (let k = 1; k < parts.length; k++) {
            const pre = '/' + parts.slice(0, k).join('/');
            if (!pset.has(pre)) { pset.add(pre); prefixes.push(pre); }
        }
    }
    const capped = list.slice(0, limit);
    return { paths: capped, prefixes, wildcards, all: capped };
}

/**
 * 校验补丁路径是否落在角色卡声明的白名单内（模型自创字段会让状态栏数字乱跳）
 * 允许：精确命中 / 命中通配 / 白名单路径的下级 / 白名单路径的上级
 * 白名单为空 → checked:false（不误报）
 */
export function validatePatchPaths(patchOrBlock, allowed, opts = {}) {
    const parsed = parsePatchOps(patchOrBlock);
    const a = allowed || {};
    const paths = (a.paths && a.paths.length ? a.paths : (a.all || [])).map(normalizePath).filter(Boolean);
    const wildcards = (a.wildcards || paths.filter((q) => q.indexOf('*') >= 0)).map(normalizePath).filter(Boolean);
    const prefixes = (a.prefixes || []).map(normalizePath).filter(Boolean);
    const known = [], extra = [], unknown = [];
    if (!paths.length && !wildcards.length) return { checked: false, ok: true, total: parsed.ops.length, known, extra, unknown, problems: parsed.problems };
    const wRes = wildcards.map((w) => new RegExp('^' + w.split('*').map((seg) => escTag(seg)).join('[^/]*') + '(?:/.*)?$'));
    for (const op of parsed.ops) {
        const q = normalizePath(op.path);
        if (!q) { unknown.push({ path: String(op.path || ''), op: op.op, reason: '缺少 path' }); continue; }
        if (paths.indexOf(q) >= 0 || wRes.some((re) => re.test(q))) { known.push(q); continue; }
        const inGroup = prefixes.some((pre) => q === pre || q.indexOf(pre + '/') === 0)
            || (opts.allowAncestor !== false && paths.some((r) => r.indexOf(q + '/') === 0));
        if (inGroup) extra.push(q); else unknown.push({ path: q, op: op.op, reason: '本卡规则里没有这个路径' });
    }
    return { checked: true, ok: unknown.length === 0, total: parsed.ops.length, known, extra, unknown, problems: parsed.problems };
}

/** 多块记账：同一结构块在一条回复里出现多次（重复输出 / 正文一份结尾一份） */
export function blockPresence(text, tags) {
    const t = String(text ?? '');
    const blocks = [];
    for (const tag of tags || []) {
        const e = escTag(tag);
        const opens = (t.match(new RegExp('<' + e + '(?:\\s[^>]*)?>', 'g')) || []).length;
        const selfs = (t.match(new RegExp('<' + e + '\\s*/\\s*>', 'g')) || []).length;
        const closes = (t.match(new RegExp('</' + e + '\\s*>', 'g')) || []).length;
        const pairs = Math.min(opens, closes);
        blocks.push({ tag: tag, opens: opens, selfs: selfs, closes: closes, pairs: pairs, extra: Math.max(0, pairs - 1) + Math.max(0, selfs - 1) });
    }
    return { blocks: blocks, duplicates: blocks.filter((b) => b.extra > 0), present: blocks.filter((b) => b.opens || b.selfs).map((b) => b.tag) };
}

export function tagsOf(text) {
    const out = new Set();
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(String(text || '')))) out.add(m[1].replace(/\/$/, ''));
    return [...out];
}

/**
 * 0.6.0：把 ST 正则脚本的 findRegex 归一化，便于抽标签 ——
 *   ① 去掉 /…/flags 定界符；② 反转义 \/ \< \>；③ 把 \s \s* \s+ \s{1,3} 折成一个空格。
 * 为什么必须做：现代卡普遍写 /<StatusPlaceHolderImpl\s*\/>/g，旧实现一个标签都抽不出来 ——
 * 锚点「看不见」→ 体检把它判成「只有格式标签」，而且 AI 忘写占位符时补不上，状态栏直接消失。
 */
export function normalizeRegexForTags(src) {
    let t = String(src ?? '');
    const m = t.match(/^\/([\s\S]*)\/([a-z]*)$/);
    if (m) t = m[1];
    t = t.split('\\/').join('/').split('\\<').join('<').split('\\>').join('>');
    t = t.replace(/\\s(?:\{[^}]*\}|[*+?])?/g, ' ');
    return t;
}

/**
 * 0.6.0：宽松标签抽取（严格抽取为空时的兜底）——
 * 认得 <(update(?:variable)?)>、<Tag\s*> 这类「标签名后面还跟了正则结构」的写法；排除通用 HTML 标签。
 */
export function tagsOfLoose(text) {
    const out = new Set();
    // 允许 <( 开头：卡里常见 <(update(?:variable)?)> 这种把标签名包进捕获组的写法
    const re = /<\(?([A-Za-z][A-Za-z0-9_!-]*)/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
        const t = m[1];
        if (!HTML_TAGS.has(t.toLowerCase())) out.add(t);
    }
    return [...out];
}

/**
 * 由角色卡的 extensions 推导守护档案
 * @param {object} ext 角色卡 data.extensions
 */
export function buildProfile(ext) {
    const anchors = new Set();      // 有「渲染脚本」（替换内容非空）盯着的标签 → 可以补
    const dataTags = new Set();
    const strippers = new Set();    // 只有「剥除脚本」（替换内容为空）盯着的标签 → 不补
    const forms = {};               // tag -> 'self'（自闭合 <Tag/>）| 'pair'（成对 <Tag>…</Tag>）
    for (const s of (ext?.regex_scripts || [])) {
        if (s.disabled) continue;
        const named = HIDE_RE.test(String(s.scriptName || ''));
        // 有明确替换内容 → 渲染脚本；明确空串 → 剥除脚本；未提供 → 退回按名字判断
        const isStripper = typeof s.replaceString === 'string' ? s.replaceString.trim() === '' : named;
        // 0.6.0：先把 findRegex 归一化（去 /…/flags 定界符 + 反转义 \/ \< \> \s*）再抽标签 ——
        // 旧实现遇到 /<StatusPlaceHolderImpl\s*\/>/g 一个标签都抽不出来，锚点因此「隐形」
        const rx = normalizeRegexForTags(s.findRegex);
        let scriptTags = tagsOf(rx);
        // 严格抽不到时退回宽松抽取（认得 <(update(?:variable)?)> 这类带正则结构的写法）；已排除通用 HTML
        if (!scriptTags.length) scriptTags = tagsOfLoose(rx);
        for (const tag of scriptTags) {
            const selfRe = new RegExp('<' + tag + '\\s*/>');
            const pairRe = new RegExp('<' + tag + '(?:\\s[^>]*)?>[\\s\\S]*?</' + tag + '>');
            if (selfRe.test(rx)) forms[tag] = 'self';
            else if (pairRe.test(rx) && !forms[tag]) forms[tag] = 'pair';
            if (DATA_RE.test(tag)) { dataTags.add(tag); continue; }
            if (isStripper) strippers.add(tag);
            else anchors.add(tag);
        }
    }
    // 同一个标签既有渲染脚本又有剥除脚本时，以渲染为准（否则永远不会补）
    const hideTargets = [...strippers].filter(t => !anchors.has(t));
    const anchorsOnly = [...anchors].filter(t => !strippers.has(t));
    const helpers = ext?.tavern_helper?.scripts || [];
    const helperText = helpers.map(s => String(s.content || '')).join('\n');
    return {
        anchors: [...anchors],
        anchorsOnly,
        dataTags: [...dataTags],
        hideTargets,
        strippers: [...strippers],
        anchorForms: forms,
        helperCount: helpers.length,
        helperRenders: helpers.length > 0 && /状态栏|StatusPlaceHolder|StatusBar/i.test(helperText),
        // 卡自己声明的「格式标签」（含中文，如 <正文>/<女主A_名字>）：来自正则的 findRegex/replaceString 与酒馆助手脚本
        rawTags: [...new Set([
            ...broadTagsOf((ext?.regex_scripts || []).map((s) => normalizeRegexForTags(s.findRegex) + ' ' + String(s.replaceString || '')).join('\n')),
            ...broadTagsOf(helperText),
        ])],
        // 只有剥除脚本盯着、没有任何渲染脚本的标签 → 不补（补了反而多出裸标签）
        injectableAnchors: [...anchors],
        // 0.6.0：卡自带的前端界面（动态状态栏 / 开局配置面板）
        views: detectFrontEndViews(ext),
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

/** 把存的 findRegex（可能带 /…/flags）编译成 RegExp；去掉 g 免得 lastIndex 有副作用 */
export function regexFromFindRegex(src) {
    const t = String(src ?? '');
    const m = t.match(/^\/([\s\S]*)\/([a-z]*)$/);
    try {
        if (m) return new RegExp(m[1], m[2].split('').filter((c) => c !== 'g').join(''));
        return new RegExp(t.replace(/^\/|\/$/g, ''));
    } catch (_) { return null; }
}

/**
 * 0.6.1：这条消息是否被卡自带的「整条消息」型前端界面认领了？
 * 实测病灶：「归真纪元」的开局面板正则写成 /^\s*【归真纪元·自定义开局】\s*$/，
 * 用 $ 锁死了整条消息 —— 只要往里补一个锚点就失配，那块 3.9MB 面板直接不渲染（面板「消失」）。
 * @returns {object|null} 命中的视图记录
 */
export function anchoredViewConsuming(views, text) {
    const t = String(text ?? '');
    if (!t) return null;
    for (const v of [...((views && views.panels) || []), ...((views && views.bars) || [])]) {
        if (!v || !v.raw || !v.anchored) continue;
        const rx = regexFromFindRegex(v.raw);
        if (!rx) continue;
        try { if (rx.test(t)) return v; } catch (_) {}
    }
    return null;
}

/**
 * 0.8.0：修「标签括号错乱」—— 模型把尖括号写成全角方括号，卡的渲染正则一个都匹配不上。
 * 实测病灶：「与继母的丝袜与日常」里模型输出
 *     【NSFW_IMG>她压在我身上/美咲_5.jpg</NSFW_IMG>
 * 而卡的插图正则要的是 <NSFW_IMG>…</NSFW_IMG> —— 一个字符之差，图片不显示、正文里只剩一串原文标签。
 * 只认**本卡声明过**的标签，且都要求括号旁边有 > 或 / 这种「本来就不该出现在方括号里」的字符：
 *   【Tag> / [Tag>        → <Tag>      （开标签）
 *   </Tag】 / 【/Tag>     → </Tag>     （闭标签）
 * 不做裸 [Tag] → <Tag>，避免把正文里的方括号误当成标签。
 * @returns {{text:string, fixed:string[]}}
 */
export function repairBracketTags(text, tags) {
    let out = String(text ?? '');
    const fixed = [];
    const OPEN_BR = '[\u3010\uff3b\\[]';
    const CLOSE_BR = '[\u3011\uff3d\\]]';
    for (const tag of (tags || [])) {
        if (!tag || !/^[A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5.!-]{0,39}$/.test(tag)) continue;
        const e = escTag(tag);
        const open = new RegExp(OPEN_BR + '\\s*(' + e + ')\\s*>', 'g');
        const closeA = new RegExp('<\\/\\s*(' + e + ')\\s*' + CLOSE_BR, 'g');
        const closeB = new RegExp(OPEN_BR + '\\s*\\/\\s*(' + e + ')\\s*[>' + CLOSE_BR.slice(1), 'g');
        // 两边都是方括号的开标签（【Tag】）只在能确证它是标签时才改：
        // 正文里已经有正规的 </Tag>，或者有方括号形式的闭标签 —— 否则宁可不动（可能是普通方括号文本）
        const bareOpen = new RegExp(OPEN_BR + '\\s*(' + e + ')\\s*' + CLOSE_BR, 'g');
        const hasClose = new RegExp('<\\/\\s*' + e + '\\s*>').test(out) || new RegExp(OPEN_BR + '\\s*\\/\\s*' + e + '\\s*' + CLOSE_BR).test(out);
        const before = out;
        out = out.replace(open, (m, t1) => '<' + t1 + '>');
        out = out.replace(closeA, (m, t1) => '</' + t1 + '>');
        out = out.replace(closeB, (m, t1) => '</' + t1 + '>');
        if (hasClose) out = out.replace(bareOpen, (m, t1) => '<' + t1 + '>');
        if (out !== before) fixed.push(tag);
    }
    return { text: out, fixed: fixed };
}

/**
 * 守护主函数（纯函数，便于单测）
 * @returns {{text:string, actions:Array<{type:string,tag:string,detail?:string}>}}
 */
export function guardText(text, profile, opts = {}) {
    const actions = [];
    let out = String(text ?? '');
    if (!out) return { text: out, actions };

    // 0) 0.6.1：消息被卡的「整条接管」型前端界面认领（开局配置面板等）→ 原样返回，绝不补锚点/补闭合
    const consumedView = anchoredViewConsuming(profile && profile.views, out);
    if (consumedView) {
        actions.push({ type: 'anchored-view-skip', tag: consumedView.name });
        return { text: out, actions: actions };
    }

    // 0) 0.8.0：先把「括号错乱」的标签改回来（【NSFW_IMG> → <NSFW_IMG>），否则卡的插图/面板正则匹配不上
    if (opts.fixBracketTags !== false) {
        const br = repairBracketTags(out, [...(profile.rawTags || []), ...(profile.anchors || []), ...(profile.dataTags || []), ...(profile.hideTargets || []), ...(profile.strippers || [])]);
        if (br.fixed.length) {
            out = br.text;
            for (const t of br.fixed) actions.push({ type: 'bracket-tag-fixed', tag: t });
        }
    }

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
        const selfRe = new RegExp("<" + tag + "\\s*/\\s*>");
        const form = (profile.anchorForms || {})[tag] || (selfRe.test(out) ? "self" : "pair");

        // ① 形态规范化：卡要自闭合 → 把模型写出的成对块折叠成 <Tag/>（卡不使用块内内容）
        if (form === "self") {
            const pairRe = new RegExp("<" + tag + "(?:\\s[^>]*)?>[\\s\\S]*?</" + tag + ">", "g");
            const before = out;
            out = out.replace(pairRe, "<" + tag + "/>");
            if (out !== before) actions.push({ type: "anchor-form-normalized", tag });
        }
        // ② 去重：同一占位符只保留一个
        const dd = dedupeSelfClosingAnchors(out, [tag]);
        if (dd.removed.length) { out = dd.text; actions.push({ type: "anchor-duplicate-merged", tag }); }

        const hasSelf = new RegExp("<" + tag + "\\s*/\\s*>").test(out);
        const opened = out.includes("<" + tag);
        const closed = out.includes("</" + tag + ">");
        if (hasSelf) continue;                                   // 已有自闭合占位符 → 无需处理
        if (opened && !closed && opts.repairClosure !== false) {  // 开了没闭合 → 补闭合
            out = out.trimEnd() + "\n</" + tag + ">";
            actions.push({ type: "anchor-close-repaired", tag });
            continue;
        }
        if (!opened && opts.injectAnchor) {                       // 完全没有 → 按设置补
            const shape = form === "self" || opts.anchorStyle === "self" ? "<" + tag + "/>" : "<" + tag + "></" + tag + ">";
            out = out.trimEnd() + "\n" + shape;
            actions.push({ type: "anchor-injected", tag });
        } else if (!opened) {
            actions.push({ type: "anchor-missing", tag });
        }
    }    return { text: out, actions };
}

/** 已知的"状态栏协议"标签族（用于检测串卡） */
export const KNOWN_PROTOCOL_TAGS = ['status!', 'StatusBar', 'StatusPlaceHolderImpl', 'StatusBlock', 'Status_block', 'StatusPanel', 'SystemTime', 'TTL'];

/**
 * 修复结构块里的「引号错配」——实测高频故障：
 *   模型写出 \`内心: "……契合。”\`（开头英文双引号、结尾中文右引号 U+201D）
 *   → js-yaml 报错 → 卡的前端解析不到数据（面板显示"未解析到角色数据"）
 * 只在给定标签族的块内逐行处理，且只修「值以 ASCII 引号开头、却以对应中文引号结尾」这一种确信情形；
 * 文本块之外的正文、以及本来就配对的行，一律不碰。
 * @returns {{text:string, fixed:Array<{tag:string, key:string}>}}
 */
export function repairSmartQuotes(text, tags) {
    let out = String(text ?? '');
    const fixed = [];
    for (const tag of tags || []) {
        const blockRe = new RegExp('(<' + tag + '(?:\\s[^>]*)?>)([\\s\\S]*?)(</' + tag + '>)', 'g');
        out = out.replace(blockRe, (whole, open, body, close) => {
            const next = String(body).split('\n').map((line) => {
                const dq = line.match(/^(\s*[^:\n]{1,40}:\s*)"([\s\S]*?)”\s*$/);
                if (dq) { fixed.push({ tag, key: dq[1].trim().replace(/:$/, '') }); return line.replace(/”\s*$/, '"'); }
                const sq = line.match(/^(\s*[^:\n]{1,40}:\s*)'([\s\S]*?)’\s*$/);
                if (sq) { fixed.push({ tag, key: sq[1].trim().replace(/:$/, '') }); return line.replace(/’\s*$/, "'"); }
                return line;
            }).join('\n');
            return open + next + close;
        });
    }
    return { text: out, fixed };
}

/**
 * 结构块 YAML「结构级」修复（0.3.0）—— 覆盖实测会让整块解析失败、卡前端直接弹「错误详情」的两类写法：
 *   a) 列表项写成行内映射，后续兄弟键却缩进更深（实测病灶：天狐3 卡）
 *        - 用户: "涂山清璃"        ← 值直接跟在键后面
 *            行动: "…"            ← 比键所在列更深 → js-yaml: bad indentation of a mapping entry
 *      修法：把行内标量**下沉**成子映射的第一个键（默认 名字），兄弟键保持原样：
 *        - 用户:
 *            名字: "涂山清璃"
 *            行动: "…"
 *      为什么下沉而不是把兄弟键左移：该卡渲染脚本 createCharacterCard() 要求 userItem[用户] 必须是**对象**，
 *      不是对象就整张角色卡不渲染；左移会让它变成字符串，卡片直接消失。
 *      若兄弟键里已经有名字类键，则只删掉行内的冗余标量。
 *   b) 引号标量后面又跟了「, 文字」（模型把两句写在一行）
 *        穿搭: "长裙堆叠。" , 衬衫由于贴合产生褶皱。
 *      修法：把逗号后的文字并回引号内（左侧已是句末标点就不再补逗号）。
 * 只在给定标签族的块内逐行处理，块外正文一律不动。
 * @returns {{text:string, fixes:Array<{tag,kind,key}>, blocks:number}}
 */
export function repairYamlStructure(text, tags, opts = {}) {
    const nameKey = String(opts.nameKey || '名字');
    const NAME_RE = new RegExp('^\\s*(名字|姓名|名称|name)\\s*:');
    let out = String(text ?? '');
    const fixes = [];
    let blocks = 0;
    const indentOf = (t) => (String(t).match(/^\s*/) || [''])[0].length;
    for (const tag of tags || []) {
        const blockRe = new RegExp('(<' + tag + '(?:\\s[^>]*)?>)([\\s\\S]*?)(</' + tag + '>)', 'g');
        out = out.replace(blockRe, (whole, open, body, close) => {
            blocks++;
            const src = String(body).split('\n');
            const dst = [];
            for (let i = 0; i < src.length; i++) {
                const line = src[i];
                const m1 = line.match(/^(\s*)-\s*([^\s:]{1,40}):[ \t]*(\S.*)$/);
                if (m1) {
                    const itemIndent = m1[1].length;
                    const keyCol = itemIndent + 2;
                    let nx = -1;
                    for (let k = i + 1; k < src.length; k++) { if (String(src[k]).trim()) { nx = k; break; } }
                    if (nx > 0 && indentOf(src[nx]) > keyCol) {
                        const sibs = [];
                        for (let k = nx; k < src.length; k++) {
                            if (String(src[k]).trim() && indentOf(src[k]) <= itemIndent) break;
                            sibs.push(src[k]);
                        }
                        const first = sibs.find((s) => String(s).trim());
                        const sibIndent = first ? indentOf(first) : keyCol + 2;
                        const hasName = sibs.some((s) => NAME_RE.test(String(s)));
                        dst.push(m1[1] + '- ' + m1[2] + ':');
                        if (!hasName) dst.push(' '.repeat(sibIndent) + nameKey + ': ' + m1[3]);
                        fixes.push({ tag: tag, kind: hasName ? 'list-inline-drop' : 'list-inline-demote', key: m1[2] });
                        continue;
                    }
                }
                const m2 = line.match(/^(\s*[^\s:]{1,40}:[ \t]*)(["'])([\s\S]*?)\2[ \t]*[,，][ \t]*(\S.*)$/);
                if (m2) {
                    const sep = /[。！？…，,、；;：:]$/.test(m2[3]) ? '' : '，';
                    dst.push(m2[1] + m2[2] + m2[3] + sep + m2[4].split('"').join('').split("'").join('') + m2[2]);
                    fixes.push({ tag: tag, kind: 'trailing-text-merged', key: (m2[1].match(/[^\s:]{1,40}/) || [''])[0] });
                    continue;
                }
                dst.push(line);
            }
            return open + dst.join('\n') + close;
        });
    }
    return { text: out, fixes: fixes, blocks: blocks };
}

/**——覆盖实测会打挂卡前端解析的两类写法：
 *   a) 值以英文引号开头、却以**中文引号**结尾：\`内心: "……。”\` → 解析器报 bad indentation → 状态栏「未解析到角色数据」
 *   b) 值**没加引号**但里面有 \`: \`（冒号+空格）或 \` #\`（空格+井号）→ YAML 会把它当嵌套键/注释，值被截断或整段解析失败
 * 只处理角色卡自己声明的结构块内的行；块外正文、已经加引号的值、\`|\`/\`>\` 字面量块内的行一律不动。
 * 无法安全判断的（例如引号开了没闭合）**只报告不修改**。
 * @returns {{text:string, fixes:Array<{tag,kind,key}>, issues:Array<{tag,key,reason}>}}
 */
export function guardBlockYaml(text, tags, opts = {}) {
    const fixQuotes = opts.fixSmartQuotes !== false;
    const quoteScalars = opts.quoteScalars !== false;
    let out = String(text ?? '');
    const fixes = [], issues = [];
    for (const tag of tags || []) {
        const blockRe = new RegExp('(<' + tag + '(?:\\s[^>]*)?>)([\\s\\S]*?)(</' + tag + '>)', 'g');
        out = out.replace(blockRe, (whole, open, body, close) => {
            let literalIndent = -1;   // 块标量（| / >）内容缩进，进入后整段跳过
            const next = String(body).split('\n').map((line) => {
                const indent = (line.match(/^\s*/) || [''])[0].length;
                if (literalIndent >= 0) {
                    if (indent > literalIndent) return line;
                    literalIndent = -1;
                }
                if (/:[ \t]*[|>][-+]?[ \t]*$/.test(line)) { literalIndent = indent; return line; }
                const m = line.match(/^(\s*)([^:\n]{1,40}):([ \t]*)(.*)$/);
                if (!m) return line;
                const key = m[2].trim(), gap = m[3] || ' ';
                const val = m[4].replace(/\s+$/, '');
                if (!val) return line;
                if (fixQuotes) {
                    const dq = val.match(/^"([\s\S]*?)”$/);
                    if (dq) { fixes.push({ tag, kind: 'quote', key }); return m[1] + m[2] + ':' + gap + '"' + dq[1] + '"'; }
                    const sq = val.match(/^'([\s\S]*?)’$/);
                    if (sq) { fixes.push({ tag, kind: 'quote', key }); return m[1] + m[2] + ':' + gap + "'" + sq[1] + "'"; }
                }
                const first = val[0];
                const alreadyQuoted = first === '"' || first === "'" || first === '|' || first === '>' || first === '[' || first === '{' || first === '-';
                if (quoteScalars && !alreadyQuoted && (val.includes(': ') || val.includes(' #') || val.endsWith(':'))) {
                    fixes.push({ tag, kind: 'quote-scalar', key });
                    return m[1] + m[2] + ':' + gap + '"' + val.split('"').join('\\"') + '"';
                }
                if (first === '"' && !/"[ \t]*$/.test(val)) issues.push({ tag, key, reason: '引号开了没闭合（不敢自动改）' });
                return line;
            }).join('\n');
            return open + next + close;
        });
    }
    return { text: out, fixes, issues };
}

/**
 * 结构块「严格 YAML 校验」（用注入的 js-yaml；扩展自带一份 vendor/js-yaml.min.js）
 * 与 guardBlockYaml 的启发式不同：这里是真的解析，能发现启发式覆盖不到的写法错误。
 * @param {object} yamlLib 形如 { load(str) } —— 没传或不可用则 checked=false（调用方据此提示"跳过"）
 * @returns {{checked:boolean, blocks:number, issues:Array<{tag,error}>}}
 */
export function strictYamlCheck(text, tags, yamlLib) {
    const issues = [];
    let blocks = 0;
    if (!yamlLib || typeof yamlLib.load !== 'function') return { checked: false, blocks: 0, issues };
    const src = String(text ?? '');
    for (const tag of tags || []) {
        const blockRe = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g');
        let m;
        while ((m = blockRe.exec(src))) {
            const body = m[1];
            if (!body || !body.trim()) continue;
            blocks++;
            try { yamlLib.load(body); }
            catch (e) {
                const msg = String((e && e.message) || e).split('\n').slice(0, 2).join(' / ').slice(0, 200);
                issues.push({ tag, error: msg });
            }
        }
    }
    return { checked: true, blocks, issues };
}

/** 从一个回复里抽出变量更新块（<UpdateVariable>…</UpdateVariable>）；不用正则，避免多层转义 */
export function extractUpdateBlock(text) {
    const s = String(text || '');
    const a = s.indexOf('<UpdateVariable');
    if (a < 0) return null;
    const b = s.indexOf('</UpdateVariable>', a);
    if (b < 0) return null;
    const block = s.slice(a, b + '</UpdateVariable>'.length);
    const pa = block.indexOf('<JSONPatch>');
    const pb = block.indexOf('</JSONPatch>');
    const patchText = (pa >= 0 && pb > pa) ? block.slice(pa + '<JSONPatch>'.length, pb).trim() : '';
    return { block: block, patchText: patchText };
}

/** 校验补出来的 JSONPatch：抽数组 → JSON.parse → 检查 op/path */
export function validatePatchBlock(blockOrPatch) {
    const parsed = parsePatchOps(blockOrPatch);
    const problems = parsed.problems.slice();
    for (const o of parsed.ops) {
        if (!o.op) problems.push('缺少 op');
        if (!o.path && o.op !== 'move') problems.push('缺少 path');
    }
    if (!parsed.ops.length && !problems.length) problems.push('空数组（没有任何操作）');
    return { ok: problems.length === 0, ops: parsed.ops.length, problems: problems };
}

/** 生成「只补变量块」的专注提示词（strict 时更短更硬，用于重试） */
export function buildVarFixPrompt(opts) {
    const o = opts || {};
    const varSpec = String(o.varSpec || '').trim();
    const required = (o.required || []).map(function (r) { return r && r.path ? r.path : ''; }).filter(Boolean);
    const body = String(o.messageText || '').slice(-(o.maxChars || 6000));
    const userText = String(o.lastUserText || '').slice(-800);
    const lines = [];
    if (o.strict) {
        lines.push('只输出一个 JSONPatch 数组，不要解释、不要代码围栏、不要其它标签。');
        lines.push('元素形如 [{"op":"replace","path":"/角色/字段","value":"新值"}]。');
    } else {
        lines.push('你是变量提取器：根据下方「本轮回复」，输出这张角色卡要求的变量更新块。不要写故事、不要解释。');
        if (varSpec) lines.push('', '本卡要求的输出格式：', varSpec);
        lines.push('', '必须覆盖的字段（缺一项都算失败）：' + (required.length ? required.join('、') : '（按卡的规则）'));
    }
    if (userText) lines.push('', '【玩家上一条输入】', userText);
    lines.push('', '【本轮回复】', body);
    lines.push('', '现在只输出' + (o.strict ? ' JSONPatch 数组' : '变量更新块（<UpdateVariable> 包裹的 JSONPatch）') + '。');
    return lines.join(String.fromCharCode(10));
}

export function normalizeMalformedClosings(text, tags) {
    let out = String(text ?? '');
    const fixed = [];
    for (const tag of tags || []) {
        const re = new RegExp('</' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!>)', 'g');
        if (re.test(out)) { out = out.replace(re, '</' + tag + '>'); fixed.push(tag); }
    }
    return { text: out, fixed };
}

/** 检测消息里是否混入了「其他角色卡」的协议标签（只报告，不改内容） */
export function detectForeignTags(text, profile) {
    const mine = new Set([...(profile?.anchors || []), ...(profile?.dataTags || []), ...(profile?.hideTargets || [])]);
    const t = String(text ?? '');
    return KNOWN_PROTOCOL_TAGS.filter(tag => !mine.has(tag) && (t.includes('<' + tag) || t.includes('</' + tag)));
}

/**
 * 生成结尾结构块提醒文本（注入 depth 0，让模型在生成前最后看到）
 * 只声明当前角色卡要求的标签，避免串卡
 */
export function buildTailReminder(profile, opts = {}) {
    const data = profile?.dataTags || [];
    const anchors = profile?.anchors || [];
    const formatTags = (profile?.rawTags || []).filter((t) => !KEEP_BLOCKS.has(t) && !KEEP_BLOCKS.has(String(t).toLowerCase()));
    if (!data.length && !anchors.length && !formatTags.length) return "";
    const lines = ["<tail_reminder>", "回复的最后必须完整输出下列结构块（当前角色卡的要求，不得省略）："];
    for (const t of data) lines.push("- <" + t + "> … </" + t + "> ：变量更新块，内容按角色卡的变量更新规则填写");
    for (const t of anchors) {
        const form = (profile.anchorForms || {})[t];
        const shape = form === 'self' ? ('只写自闭合占位符 <' + t + '/>，标签内不要填写任何内容') : ('<' + t + '> … </' + t + '>（按角色卡规定的字段填写）');
        lines.push('- ' + shape + ' ：状态栏块');
    }
    if (data.length && opts.required && opts.required.length) {
        lines.push("", "本轮必须更新的字段（按角色卡的 check 条件，缺一项都算失败）：");
        for (const f of opts.required) lines.push("- " + f.path + (f.check ? "（" + f.check.slice(0, 60) + "）" : ""));
    }
    if (data.length && opts.varSpec) { lines.push("", "变量更新块的格式示例（照此填写，路径/字段名以角色卡为准）：", opts.varSpec.trim()); }
    if (formatTags.length && !data.length) {
        lines.push("", "本卡前端要求正文里包含这些标签（标签名与顺序以本卡世界书为准）：" + formatTags.map((t) => "<" + t + ">").join("、"));
    }
    lines.push("所有标签必须成对完整闭合；不得自创标签；不得使用其他角色卡的标签。");
    lines.push("不要把世界书/设定/系统提示的原文回显进正文，也不要输出本卡没声明的结构块。");
    if (data.length || anchors.length) lines.push("结构块内的字符串引号必须配对：用英文半角双引号 \"…\" 包起来，不要出现开头是 \" 结尾却是中文引号 ” 的情况（那会让状态栏解析失败）。");
    lines.push("</tail_reminder>");
    return lines.join("\n");
}

/** 合并重复的自闭合锚点（续写经常追加出第二个）：只保留最后一个，其余删除 */
export function dedupeSelfClosingAnchors(text, tags) {
    let out = String(text ?? "");
    const removed = [];
    for (const tag of tags || []) {
        const re = new RegExp("<" + tag + "\\s*/\\s*>", "g");
        const hits = out.match(re) || [];
        if (hits.length < 2) continue;
        // 保留最后一个，删除其余
        let seen = 0;
        out = out.replace(re, () => { seen++; return seen < hits.length ? "" : "<" + tag + "/>"; });
        removed.push(tag + "×" + (hits.length - 1));
    }
    return { text: out, removed };
}

/**
 * 从角色卡世界书条目里抽出「变量更新块」的格式片段（模型最容易照抄的那段）
 * 优先取 format: 段；否则取第一个 <UpdateVariable>…</UpdateVariable>
 */
export function extractVarSpec(entries, maxLen = 600) {
    const text = (entries || []).map(e => String(e?.content || "")).join("\n");
    if (!text) return "";
    let block = "";
    const fm = text.match(/format\s*:\s*\|?-?\s*\n([\s\S]{0,1200}?)(?=\n\s{0,4}[a-zA-Z_]+\s*:|\n\s*---)/);
    if (fm && /<UpdateVariable>/.test(fm[1])) block = fm[1];
    if (!block) {
        const m = text.match(/<UpdateVariable>[\s\S]{0,1200}?<\/UpdateVariable>/);
        if (m) block = m[0];
    }
    if (!block) return "";
    block = block.replace(/\r/g, "").split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim() !== "").slice(0, 24).join("\n");
    return [...block].length > maxLen ? [...block].slice(0, maxLen).join("") + " …" : block;
}

/**
 * 从角色卡世界书条目里抽出「本轮必须更新的字段清单」。
 * v0.5.0：不再写死「组(缩进2) / 字段(缩进4)」—— 实测 90 张卡里有 12 张因为规则层级不固定而抽不出来。
 * 真实写法（都已进夹具）：
 *   系统: / 日期:                        ← 组 + 字段
 *   世界信息.历法: / type: / check:      ← 键本身就是点分路径
 *   炼丹_熟练度: / type / check          ← 键可能带 $ 前缀
 *   变量结构: / 世界: / 日期: string      ← 多层包装（变量结构/工作流程 这类包装层不进路径）
 * 规则：按缩进栈推导路径；遇到 check: 就把上方最近的键认作**必更字段**，其后的缩进行是条件文本。
 * @returns {Array<{path:string, check:string}>}
 */
export function extractRequiredFields(entries, limit = 10) {
    const META = /^(type|range|format|rule|output|outputs|paths|commands|example|examples|default|desc|description|说明|示例|备注|note|可选项|枚举)$/i;
    const WRAP = /^(变量更新规则|变量规则|更新规则|变量结构|结构|变量列表|variables?|工作流程|flow|当前变量信息|变量系统)$/i;
    const out = [];
    const seen = new Set();
    const ancestors = (rows, j) => {
        const parts = [rows[j].key];          // 字段自身的键
        let indent = rows[j].indent;
        for (let k = j - 1; k >= 0; k--) {
            const p = rows[k];
            if (!p.isKey || p.indent >= indent) continue;
            indent = p.indent;
            if (META.test(p.key) || WRAP.test(p.key)) continue;
            parts.unshift(p.key);
        }
        return parts;
    };
    for (const entry of (entries || [])) {
        const text = String(entry?.content || '');
        const comment = String(entry?.comment || '');
        if (!/变量更新规则|变量规则|更新规则|变量结构|\[mvu_update\]/i.test(text + ' ' + comment)) continue;
        const rows = [];
        for (const rawLine of text.replace(/\t/g, '    ').split(/\r?\n/)) {
            const body = String(rawLine).trim();
            if (!body) continue;
            if (/^(---|\.\.\.)/.test(body) || /^#/.test(body) || /^\/\//.test(body)) continue;
            const indent = String(rawLine).length - String(rawLine).replace(/^\s+/, '').length;
            const m = body.match(/^(\$?[^\s:：#>\x60]{1,60})\s*[：:]\s*(.*)$/);
            rows.push({ indent: indent, key: m ? m[1].replace(/^\$/, '').trim() : '', rest: m ? String(m[2] || '').trim() : '', isKey: !!m, raw: body });
        }
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (!r.isKey) continue;
            // 0.7.0：check 的三种写法都要认（①②以前会漏，实测「蛊」「欲妈群」因此被判「抽不到规则」）——
            //   ① check:              + 缩进列表（一直支持）
            //   ② check: 条件文本       同行直接给条件
            //   ③ 字段: { …, check: 条件文本 }   整个字段写成行内对象
            const isCheckRow = /^check$/i.test(r.key);
            const isInlineObj = !isCheckRow && /[{,，]\s*check\s*[:：]/i.test(r.rest || "");
            if (!isCheckRow && !isInlineObj) continue;
            let ownIdx = i;
            if (isCheckRow) {
                ownIdx = -1;
                for (let j = i - 1; j >= 0; j--) {
                    const p = rows[j];
                    if (!p.isKey || p.indent >= r.indent) continue;
                    if (META.test(p.key) || WRAP.test(p.key)) continue;
                    ownIdx = j; break;
                }
            }
            if (ownIdx < 0) continue;
            const cond = [];
            if (isCheckRow) {
                // ② 同行条件（竖线/大于号是块标量标记，条件在下面的缩进行里）
                if (r.rest && !/^[|>][-+]?\s*$/.test(r.rest)) cond.push(r.rest);
                for (let k = i + 1; k < rows.length; k++) {
                    const p = rows[k];
                    if (p.indent <= r.indent) break;
                    if (p.isKey && !/^[-*]/.test(p.raw)) break;
                    const item = p.raw.replace(/^[-*]\s*/, "").replace(/^[：:]\s*/, "").trim();
                    if (item) cond.push(item);
                }
            } else {
                // ③ 行内对象：取 check 后面到逗号或右花括号为止
                const m = String(r.rest).match(/[{,，]\s*check\s*[:：]\s*([^,}，]*)/i);
                const text = m && m[1] ? m[1].trim() : "";
                if (text) cond.push(text);
            }
            const path = ancestors(rows, ownIdx).join(".");
            if (!path || !cond.length) continue;
            const dedup = path + "|" + cond.join(" / ");
            if (seen.has(dedup)) continue;
            seen.add(dedup);
            out.push({ path: path, check: cond.join(" / ") });
        }
    }
    const expanded = [];
    for (const f of out) for (const q of expandTemplateGroups([f.path])) expanded.push({ path: q, check: f.check });
    return expanded.slice(0, limit);
}
/**
 * 0.7.0：规则条目「为什么抽不出必更字段」—— 只归类，不猜不编。
 * 体检里给 no-rules 的卡标出原因，用户一眼能看出是没写规则、还是写法没认出来。
 * @returns {"check-unparsed"|"command"|"paths"|"structure"|"schema"|"prose"|"none"}
 */
export function classifyNoRules(entries, ext) {
    const text = (entries || []).map((e) => String(e?.content || "")).join("\n");
    // 行级 check: 或行内对象里的 , check:
    if (/^\s*check\s*[:：]/im.test(text) || /[{,，]\s*check\s*[:：]/i.test(text)) return "check-unparsed";
    if (/_\s*\.\s*(set|assign|remove|add)\s*\(/.test(text)) return "command";
    if (/^\s*paths\s*[:：]/im.test(text)) return "paths";
    if (/^\s*(变量结构|变量列表|变量说明)\s*[:：]/m.test(text)) return "structure";
    // 规则条目本身就写成散文（有「更新/变动」但没有任何机器可读标记）→ prose 比 schema 更贴近事实
    const ruleText = (entries || []).filter((e) => /变量更新规则|变量规则|更新规则|变量结构|\[mvu_update\]/i.test(String(e?.content || "") + " " + String(e?.comment || ""))).map((e) => String(e?.content || "")).join("\n");
    // 规则条目本身写成散文 → prose（规则在那儿，只是没有机器可读标记）
    if (/更新|变动|变化|规则/.test(ruleText) && ruleText.replace(/\s+/g, "").length > 200) return "prose";
    const scripts = ((ext && ext.tavern_helper && ext.tavern_helper.scripts) || []).map((s) => String(s.content || "")).join("\n");
    if (/registerMvuSchema|z\s*\.\s*object\s*\(/.test(scripts)) return "schema";
    // 规则条目都没单独命名，但整本世界书里到处都是「规则/更新」的散文
    if (/更新|变动|变化|规则/.test(text) && text.replace(/\s+/g, "").length > 200) return "prose";
    return text.trim() ? "other" : "none";
}

/**
 * 统计模型写出的 <UpdateVariable> 块覆盖了哪些必更字段
 * @returns {{total:number, covered:string[], missing:string[]}}
 */
export function patchCoverage(text, required) {
    const t = String(text || "");
    const blocks = extractUpdateBlocks(t);
    const block = blocks.length ? blocks.map((b) => b.block).join(String.fromCharCode(10)) : t;
    const norm = (q) => normalizePath(q) || String(q || "");
    const covered = [], missing = [];
    for (const f of (required || [])) {
        const want = norm(f.path);
        if (block.indexOf(want) >= 0) covered.push(f.path); else missing.push(f.path);
    }
    const written = [];
    const seen = new Set();
    for (const b of blocks) {
        for (const op of parsePatchOps(b.patchText || b.block).ops) {
            const q = normalizePath(op.path);
            if (q && !seen.has(q)) { seen.add(q); written.push(q); }
        }
    }
    return { total: (required || []).length, covered: covered, missing: missing, written: written, blocks: blocks.length };
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
/** 行内 Markdown：**粗体** 与 `行内代码`（输入已在 renderChangelogMarkdown 里转义过） */
function mdInline(s) {
    return String(s)
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * 极简 Markdown → HTML（0.3.1）：只用于把扩展自己的 CHANGELOG.md 显示在弹窗里。
 * 先把整段文本转义（& < >），再做白名单替换 —— 所以 CHANGELOG 里就算写了 HTML 也不会被当标签执行。
 * 支持：标题 #~######、无序列表 - 与 *、引用 >、分隔线 ---、代码围栏、**粗体**、行内代码、段落。
 */
export function renderChangelogMarkdown(md) {
    const esc = String(md == null ? '' : md).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
    const out = [];
    let inList = false, inPre = false, inQuote = false;
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };
    for (const line of esc.split('\n')) {
        if (/^\s*```/.test(line)) {
            closeList(); closeQuote();
            if (inPre) { out.push('</pre>'); inPre = false; } else { out.push('<pre class="cc-md-pre">'); inPre = true; }
            continue;
        }
        if (inPre) { out.push(line); continue; }
        const t = line.trim();
        if (!t) { closeList(); closeQuote(); continue; }
        const h = t.match(/^(#{1,6})\s+(.*)$/);
        if (h) { closeList(); closeQuote(); const lv = Math.min(6, h[1].length); out.push('<h' + lv + '>' + mdInline(h[2]) + '</h' + lv + '>'); continue; }
        if (/^([-*_])\1{2,}$/.test(t)) { closeList(); closeQuote(); out.push('<hr>'); continue; }
        if (/^&gt;\s?/.test(t)) { closeList(); if (!inQuote) { out.push('<blockquote>'); inQuote = true; } out.push('<p>' + mdInline(t.replace(/^&gt;\s?/, '')) + '</p>'); continue; }
        if (/^[-*]\s+/.test(t)) { closeQuote(); if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + mdInline(t.replace(/^[-*]\s+/, '')) + '</li>'); continue; }
        closeList(); closeQuote();
        out.push('<p>' + mdInline(t) + '</p>');
    }
    closeList(); closeQuote(); if (inPre) out.push('</pre>');
    return out.join('\n');
}

/**
 * 变量协议识别（0.4.0）：不同角色卡用的是完全不同的"变量/状态"协议，不能只认 MVU 一种。
 * 输入是「卡的文本汇总」（正则 findRegex/replaceString + 酒馆助手脚本 + 世界书条目）
 * 与卡声明的结构标签，输出协议档案供面板显示、覆盖度统计与能力标注使用。
 * @returns {{id:string, label:string, canWriteBack:boolean, tags:string[], sample:string}}
 */
export function detectVariableProtocol(opts = {}) {
    const text = String(opts.text || '');
    const spec = String(opts.varSpec || '');
    const dataTags = (opts.dataTags || []).map(String);
    const blockTags = (opts.blockTags || []).map(String);
    const both = text + String.fromCharCode(10) + spec;
    const has = (re) => re.test(both);
    if (has(/<UpdateVariable\b/i) || dataTags.some((t) => /UpdateVariable/i.test(t))) {
        return { id: 'mvu', label: 'MVU：<UpdateVariable> + <JSONPatch>', canWriteBack: true, tags: ['UpdateVariable'], sample: '<UpdateVariable><JSONPatch>[…]</JSONPatch></UpdateVariable>' };
    }
    if (has(/<JSONPatch>/i)) {
        return { id: 'jsonpatch', label: '任意标签内的 <JSONPatch>', canWriteBack: true, tags: dataTags, sample: '<Tag><JSONPatch>[…]</JSONPatch></Tag>' };
    }
    const yamlish = /^[ \t]{0,6}[^\s:#]{1,24}:[ \t]*\S/m.test(text) && blockTags.length > 0;
    if (yamlish) {
        return { id: 'yaml-block', label: 'YAML 结构块（' + blockTags.join(' / ') + '）', canWriteBack: false, tags: blockTags, sample: '<' + blockTags[0] + '>' + String.fromCharCode(10) + '字段: 值' + String.fromCharCode(10) + '</' + blockTags[0] + '>' };
    }
    if (has(/_[ \t]*\.[ \t]*set[ \t]*\(/)) {
        return { id: 'lodash-set', label: "_.set('角色.字段', 值)", canWriteBack: false, tags: [], sample: "_.set('角色.好感', 10);" };
    }
    if (has(/\{\{[ \t]*setvar::/)) {
        return { id: 'setvar-macro', label: '{{setvar::名::值}} 宏', canWriteBack: false, tags: [], sample: '{{setvar::好感::10}}' };
    }
    return { id: 'none', label: '（本卡未声明变量/状态协议）', canWriteBack: false, tags: [], sample: '' };
}

/** 从回复里抽出 _.set('a.b', …) 这类写法用到的路径（归一成 /a/b 便于比对） */
export function extractSetPaths(text) {
    const out = [];
    const seen = new Set();
    const re = /_[ \t]*\.[ \t]*set[ \t]*\([ \t]*['"]([^'"]{1,80})['"]/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
        const q = normalizePath(m[1]);
        if (q && !seen.has(q)) { seen.add(q); out.push(q); }
    }
    return out;
}

/**
 * 按协议统计"必更字段覆盖度"：
 *   mvu / jsonpatch → 看补丁里出现的路径
 *   lodash-set      → 看 _.set('路径', …) 出现的路径
 *   其它协议（YAML 块 / 宏）→ 退化为"文本里是否出现字段名"的粗略判断
 * @returns {{total:number, covered:string[], missing:string[], written:string[], kind:string}}
 */
export function coverageByProtocol(text, required, protocol) {
    const kind = (protocol && protocol.id) || 'mvu';
    const t = String(text || '');
    const written = [];
    const seen = new Set();
    if (kind === 'lodash-set') {
        for (const q of extractSetPaths(t)) { if (!seen.has(q)) { seen.add(q); written.push(q); } }
    } else {
        for (const b of extractUpdateBlocks(t)) {
            for (const op of parsePatchOps(b.patchText || b.block).ops) {
                const q = normalizePath(op.path);
                if (q && !seen.has(q)) { seen.add(q); written.push(q); }
            }
        }
    }
    const covered = [], missing = [];
    for (const f of (required || [])) {
        const want = normalizePath(f.path) || String(f.path || '');
        const hit = written.indexOf(want) >= 0 || (kind !== 'lodash-set' && t.indexOf(want) >= 0);
        if (hit) covered.push(f.path); else missing.push(f.path);
    }
    return { total: (required || []).length, covered, missing, written, kind };
}

/** 把一张卡的文本汇总起来（协议识别 / 体检用）：主字段 + 正则脚本 + 酒馆助手脚本 + 世界书 */
export function cardTextOf(card, max = 200000) {
    try {
        const d = card && card.data ? card.data : (card || {});
        const parts = [];
        for (const k of ['description', 'personality', 'scenario', 'system_prompt', 'post_history_instructions', 'first_mes', 'mes_example']) {
            const v = d[k];
            if (typeof v === 'string' && v) parts.push(v.slice(0, 20000));
        }
        const ext = d.extensions || {};
        for (const s of (ext.regex_scripts || [])) parts.push(String(s.findRegex || '') + ' ' + String(s.replaceString || ''));
        const th = ext.tavern_helper || {};
        for (const s of (th.scripts || [])) parts.push(String(s.content || '').slice(0, 40000));
        const entries = (d.character_book && d.character_book.entries) || [];
        for (const e of entries) parts.push(String(e.content || '').slice(0, 20000));
        return parts.join(String.fromCharCode(10)).slice(0, max);
    } catch (_) { return ''; }
}

const VIEW_BAR_RE = /StatusPlaceHolder|StatusBar|状态栏/i;
const VIEW_PANEL_RE = /<!DOCTYPE html|<script|onclick=|addEventListener/i;
const VIEW_DYN_RE = /stat_data|format_message_variable|\{\{|getVariables|getvar/i;

/**
 * 0.6.0：识别卡自带的「前端界面」脚本 —— 动态状态栏 / 开局配置面板。
 * 这类卡的状态栏是**动态**的：AI 只输出一个占位符，真正的 HTML 由前端正则按当前变量算出来，
 * 所以 card-compat 能帮的不是渲染，而是「占位符缺了就补上、别去动那块 HTML」。
 * 判定：替换内容非空、够长、含 HTML，且脚本没被禁用。
 * @param {object} ext 角色卡 data.extensions
 * @returns {{bars:Array, panels:Array, dynamic:boolean}}
 */
export function detectFrontEndViews(ext) {
    const bars = [];
    const panels = [];
    for (const s of (ext?.regex_scripts || [])) {
        if (s.disabled) continue;
        const rep = typeof s.replaceString === 'string' ? s.replaceString : '';
        if (!rep || rep.trim() === '' || rep.length < 400 || rep.indexOf('<') < 0) continue;
        const name = String(s.scriptName || '');
        const find = normalizeRegexForTags(s.findRegex);
        // raw 留着给「这条消息是不是被它整条接管」判断用；anchored=正则用 ^ 或 $ 锁住了整条消息
        const rec = { name: name, len: rep.length, raw: String(s.findRegex || ''), anchored: /^\^/.test(find) || /\$$/.test(find), markdownOnly: s.markdownOnly !== false, placement: s.placement };
        if (VIEW_BAR_RE.test(name) || /StatusPlaceHolder|状态栏/i.test(find)) {
            rec.dynamic = VIEW_DYN_RE.test(rep) || /<\s*script/i.test(rep);
            bars.push(rec);
        } else if (VIEW_PANEL_RE.test(rep) && rep.length > 2000) panels.push(rec);
        else if (rep.length > 20000) panels.push(rec);
    }
    return { bars: bars, panels: panels, dynamic: bars.some((b) => b.dynamic) };
}

/**
 * 兼容性体检（0.6.0）：对一份角色卡列表跑一遍 card-compat 的全部判定，
 * 给出「每张卡能做什么、为什么降级」。纯函数，喂 ST 的 getContext().characters 即可。
 * verdict 取值：
 *   ok           有锚点/数据块，且规则或协议可用
 *   guard-only   只有锚点（能补/修占位符，没有变量块）
 *   no-rules     有变量块但世界书里抽不到「+ check」规则（覆盖度/白名单不可用）
 *   read-only    变量协议不可写回（YAML 结构块等）
 *   format-only  无锚点无数据块，但声明了格式标签（只能提醒）
 *   helper-only  无锚点无数据块，但卡自带酒馆助手脚本（状态栏由它负责）
 *   dyn-bar      无锚点无数据块，但卡自带前端状态栏正则（动态状态栏；只能提醒 + 不碰那块 HTML）
 *   plain        纯正文卡（不需要 card-compat 做任何事）
 *   error        解析异常
 * @returns {{summary:object, rows:Array}}
 */
export function scanCardCompatibility(cards) {
    const rows = [];
    for (const ch of (cards || [])) {
        try {
            const d = ch && ch.data ? ch.data : (ch || {});
            const ext = d.extensions || {};
            const prof = buildProfile(ext);
            const entries = (d.character_book && d.character_book.entries) || [];
            const required = extractRequiredFields(entries, 200);
            const varSpec = extractVarSpec(entries);
            const allowed = extractAllowedPaths(entries, { limit: 400 });
            const proto = detectVariableProtocol({ text: cardTextOf(ch), varSpec: varSpec, dataTags: prof.dataTags, blockTags: [...prof.dataTags, ...prof.anchors] });
            const hasAnchor = (prof.anchors || []).length > 0;
            const hasData = (prof.dataTags || []).length > 0;
            const views = prof.views || { bars: [], panels: [], dynamic: false };
            const hasBar = (views.bars || []).length > 0;
            let verdict = 'ok';
            if (!hasAnchor && !hasData) {
                if (hasBar) verdict = 'dyn-bar';
                else verdict = (prof.rawTags || []).length ? 'format-only' : (prof.helperCount > 0 ? 'helper-only' : 'plain');
            }
            else if (!hasData) verdict = 'guard-only';
            else if (!required.length) verdict = 'no-rules';
            else if (!proto.canWriteBack && proto.id !== 'none') verdict = 'read-only';
            rows.push({
                name: String(d.name || ch?.name || '（无名）'),
                verdict: verdict,
                protocol: proto.id,
                canWriteBack: !!proto.canWriteBack,
                anchors: (prof.anchors || []).length,
                dataTags: (prof.dataTags || []).length,
                hides: (prof.hideTargets || []).length,
                rawTags: (prof.rawTags || []).length,
                helper: prof.helperCount || 0,
                book: entries.length,
                required: required.length,
                // 0.7.0：没抽到规则时标出「为什么」——是没写规则，还是写法没认出来
                ruleStyle: (!required.length && hasData) ? classifyNoRules(entries, ext) : "",
                allowedPaths: allowed.paths.length,
                varSpec: String(varSpec || '').length > 40,
                bars: (views.bars || []).length,
                panels: (views.panels || []).length,
                dynBar: !!views.dynamic,
            });
        } catch (e) {
            rows.push({ name: '（解析失败）', verdict: 'error', reason: String((e && e.message) || e) });
        }
    }
    const by = (fn) => rows.filter(fn).length;
    const protoHist = {};
    const verdictHist = {};
    for (const r of rows) {
        protoHist[r.protocol] = (protoHist[r.protocol] || 0) + 1;
        verdictHist[r.verdict] = (verdictHist[r.verdict] || 0) + 1;
    }
    const total = rows.length;
    const summary = {
        total: total,
        protocol: protoHist,
        verdicts: verdictHist,
        anchors: by((r) => r.anchors > 0),
        dataBlocks: by((r) => r.dataTags > 0),
        rules: by((r) => r.required > 0),
        varSpec: by((r) => r.varSpec),
        helper: by((r) => r.helper > 0),
        hides: by((r) => r.hides > 0),
        writable: by((r) => r.canWriteBack),
        guardable: by((r) => r.anchors > 0 || r.dataTags > 0),
        dynBars: by((r) => r.bars > 0),
        dynBarsDynamic: by((r) => r.bars > 0 && r.dynBar),
        panels: by((r) => r.panels > 0),
        noRulesStyles: rows.reduce((m, r) => { if (r.ruleStyle) m[r.ruleStyle] = (m[r.ruleStyle] || 0) + 1; return m; }, {}),
    };
    return { summary: summary, rows: rows };
}

export function isStale(prevText, curText) {
    if (!prevText || !curText) return { stale: false, reason: 'no-prev' };
    const a = freshnessFields(prevText), b = freshnessFields(curText);
    const keys = ['day', 'date', 'time', 'place', 'weather'].filter(k => a[k] && b[k]);
    if (!keys.length) return { stale: false, reason: 'no-fields' };
    const same = keys.filter(k => a[k] === b[k]);
    return { stale: same.length === keys.length, compared: keys.length, same: same.length, fields: { prev: a, cur: b } };
}
