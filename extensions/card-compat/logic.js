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
    const keptAsTitle = [];
    // 0.19.0 修复（实测 95 张卡，81 张会误删）：世界书里常写成 <阿库娅>设定…</阿库娅>、<world_setting>…</world_setting>
    // —— 这是**条目名**，不是模型乱写的结构块。旧实现只看「卡的正则声明过没」，于是把这些条目名当未声明块删掉。
    // 现在收两份名单：① 世界书条目的 comment/key（条目名）② 条目标题形态的候选（全大写/下划线风格）。
    const titleKeys = new Set();
    for (const raw of (opts.bookTitles || [])) {
        const s = String(raw == null ? '' : raw).trim();
        if (!s) continue;
        titleKeys.add(s.toLowerCase());
        titleKeys.add(s.toLowerCase().split('\n')[0].trim());
    }
    /** 条目名形态：全大写/含下划线/含点/纯 ASCII —— 世界书条目名几乎都长这样，而模型自创块（如 status_block）也长这样，
     *  所以这条只在「没有任何世界书名单」时不启用；有名单时靠名单本身判定。 */
    const looksLikeEntryName = (n) => /[A-Z_]/.test(n) && /^[A-Za-z0-9_.\-~!]+$/.test(n);
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
        // ① 世界书条目名 → 绝不清理（这是本条修复的核心）
        if (titleKeys.has(name.toLowerCase())) { keptAsTitle.push(name); continue; }
        // ② 世界书里任意条目名与这个标签同名（标签被包进条目名，如 <world_setting> 出现在 comment 里）→ 也不清理
        for (const tk of titleKeys) { if (tk && (tk.indexOf(name.toLowerCase()) >= 0 || name.toLowerCase().indexOf(tk) >= 0) && tk.length >= 4) { keptAsTitle.push(name); break; } }
        if (keptAsTitle[keptAsTitle.length - 1] === name) continue;
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
    return { text: out, removed, unclosed, keptAsTitle };
}

/** 正则转义（标签名里可能有 status! 这类元字符） */
function escTag(name) {
    return String(name ?? '').replace(/[.*+?^{}()|[\]\\$]/g, '\\$&');
}

/**
 * 0.21.3（实测根因修复）：模型常把路径写成模板式 `${/林婉婷/穿搭}` 或 `{{/林婉婷/穿搭}}` ——
 * JSON Pointer 不认这种包裹，于是整条 op 的父路径找不到 → **静默跳过**。
 * 实测（用户那张卡）：楼 #5 的 9 条补丁路径**全部**带 `${}`，导致整楼 patch 全灭（含 现金/支出/互动次数）。
 * 这里只剥「整串包裹」与残缺的 `${`/`{` 前缀、尾部多余的 `}`，不碰路径中间的字符。
 */
export function unwrapPathWrapper(raw) {
    let p = String(raw == null ? '' : raw).trim();
    for (let i = 0; i < 3; i++) {
        const m = p.match(/^\$\{([\s\S]*)\}$/) || p.match(/^\{\{([\s\S]*)\}\}$/);
        if (!m) break;
        p = m[1].trim();
    }
    p = p.replace(/^\$\{/, '').replace(/^\{\{/, '');
    while (p.length > 1 && p.charAt(p.length - 1) === '}') p = p.slice(0, -1);
    return p.trim();
}

/** 变量路径归一：点号分隔 → 斜杠开头；去掉空白与多余斜杠；保留末段通配 * */
export function normalizePath(raw) {
    let p = unwrapPathWrapper(String(raw ?? '').trim().replace(/^["']|["']$/g, ''));
    p = p.split('.').join('/').split('｜').join('/');
    p = p.replace(/\/{2,}/g, '/').replace(/\s+/g, '');
    if (!p) return '';
    if (p.charAt(0) !== '/') p = '/' + p;
    return p.replace(/\/$/, '');
}

const D = String.fromCharCode(36);   // 美元符常量：拼正则用，避免源码里出现模板组起始标记
// 0.9.3：`$` 变成可选 —— 实测「破产后姐姐…」卡里 17 条规则写成 {林婉婷|陈慧兰}（不带 $），
// 旧模式只认 ${A|B}，于是这些路径原样带着花括号进了「必更字段」清单（MVU 里并不存在这种路径）
const TPL_RE = new RegExp('\\' + D + '?\\{([^}]+)\\}');

/**
 * 展开「模板组」：一条规则里可以出现多组，组名/字段名/路径段都可能带
 *   系统.模板组(日期|时间) → 系统.日期 / 系统.时间
 * @returns {string[]} 去重后的展开结果（保序）
 */
/** 展开上限：多组 {a|b} 是指数级的（实测 8 组 ×10 = 1 亿条、主线程直接卡死），超过就截断并记账 */
export const TPL_EXPAND_CAP = 2000;
/** 上一次展开是否被上限截断（调用方可用于提示；纯函数不改其它行为） */
export const expandStats = { truncated: 0 };
export function expandTemplateGroups(values, maxRounds = 8) {
    expandStats.truncated = 0;
    let pool = (values || []).map((v) => String(v ?? ''));
    for (let round = 0; round < (Number(maxRounds) || 8); round++) {
        let changed = false;
        const next = [];
        for (const v of pool) {
            const mm = TPL_RE.exec(v);
            if (!mm) { next.push(v); continue; }
            changed = true;
            let stopped = false;
            for (const alt of mm[1].split(/[|｜]/)) {
                if (next.length >= TPL_EXPAND_CAP) { stopped = true; break; }
                next.push(v.slice(0, mm.index) + alt.trim() + v.slice(mm.index + mm[0].length));
            }
            if (stopped) { expandStats.truncated++; break; }
        }
        pool = next;
        if (!changed || expandStats.truncated) break;
    }
    const out = [...new Set(pool)];
    return out.length > TPL_EXPAND_CAP ? out.slice(0, TPL_EXPAND_CAP) : out;
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
    let wrapped = 0;   // 0.21.3：有多少条路径原本被 ${} / {{}} 包裹（面板与日志要能看见）
    for (const frag of frags) {
        const frag2 = String(frag);
        // 按括号配对逐个试「平衡的 JSON 数组」：原先取首个 [ 到末个 ]，块内任何说明文字（如「（说明：[已更新]）」）都会让 JSON.parse 失败、整段补丁被丢弃；
        // 现在遇到非 JSON 的括号候选（例如「分析[1]:」）会继续往后找下一个候选。
        const cands = [];
        {
            let from = 0;
            while (cands.length < 20) {
                const st = frag2.indexOf('[', from);
                if (st < 0) break;
                let depth = 0, inStr = false, esc = false, end = -1;
                for (let k = st; k < frag2.length; k++) {
                    const ch = frag2[k];
                    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
                    if (ch === '"') { inStr = true; continue; }
                    if (ch === '[') depth++;
                    else if (ch === ']') { depth--; if (depth === 0) { end = k; break; } }
                }
                if (end < 0) break;
                cands.push(frag2.slice(st, end + 1));
                from = end + 1;
            }
        }
        if (!cands.length) cands.push(String(frag));
        // 优先取「元素全是对象」的候选（[1] 这类说明性方括号会被跳过），退而取第一个能解析的数组
        let arr = null, fallback = null, lastErr = null;
        for (const c of cands) {
            try {
                const a = JSON.parse(c.trim());
                if (!Array.isArray(a)) continue;
                if (!fallback) fallback = a;
                if (a.every((x) => x && typeof x === 'object' && !Array.isArray(x))) { arr = a; break; }
            } catch (e) { lastErr = e; }
        }
        if (!arr) arr = fallback;
        if (!arr) { problems.push('JSON 解析失败: ' + String((lastErr && lastErr.message) || '没有可解析的 JSON 数组').slice(0, 80)); continue; }
        if (!Array.isArray(arr)) { problems.push('不是数组'); continue; }
        for (const el of arr) {
            if (!el || typeof el !== 'object') { problems.push('元素不是对象'); continue; }
            // 0.21.3：把 `${/a/b}` / `{{/a/b}}` 还原成 `/a/b` —— 模型时不时写成模板式，
            // 而 JSON Pointer 不认包裹 → 父路径找不到 → 整条 op 静默跳过（实测整楼 9 条全灭）
            for (const key of ['path', 'from']) {
                const rawPath = el[key];
                if (typeof rawPath !== 'string' || !rawPath) continue;
                const fixed = unwrapPathWrapper(rawPath);
                if (fixed && fixed !== rawPath) { el[key] = fixed; if (key === 'path') wrapped++; }
            }
            ops.push(el);
        }
    }
    return { ops, problems, frags: frags.length, wrapped };
}

/** 抽出一条回复里的全部变量块（多块记账用；extractUpdateBlock 仍只返回第一个） */
export function extractUpdateBlocks(text) {
    const s = String(text || '');
    const out = [];
    let i = 0;
    const lc = s.toLowerCase();
    while (true) {
        const a = lc.indexOf('<updatevariable', i);
        if (a < 0) break;
        const gt = s.indexOf('>', a);
        if (gt < 0) break;
        const b = lc.indexOf('</updatevariable>', gt);
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
        // 0.9.0：被禁用的大块渲染正则（状态栏/插图/面板），以及卡自带脚本会不会运行时开启
        disabledViews: detectDisabledViews(ext),
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
        // 词边界：<Update 不能用 includes 判定（会把 <UpdateVariable> 也算命中），闭合同理（</Status> 不能在 </StatusBar> 里命中）
        const openRe = new RegExp('<' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s/>])');
        const closeRe = new RegExp('</' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s>])');
        const opened = openRe.test(out);
        const closed = closeRe.test(out);
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
                    // 只剥外层包裹引号：原实现把整段里的所有引号都删掉（「他说"你好"」会变成「他说你好」）
                    const stripOuter = (str) => {
                        const s = String(str || '');
                        const pairs = [['"', '"'], ["'", "'"]];
                        for (const [a, b] of pairs) {
                            if (s.length > 1 && s.startsWith(a) && s.endsWith(b) && s.slice(a.length, s.length - b.length).indexOf(a) === -1) {
                                return s.slice(a.length, s.length - b.length);
                            }
                        }
                        return s;
                    };
                    dst.push(m2[1] + m2[2] + m2[3] + sep + stripOuter(m2[4]) + m2[2]);
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
                    // 反斜杠必须一起转义：YAML 双引号里 "C:\new" 会被解析成换行
                    return m[1] + m[2] + ':' + gap + '"' + val.split('\\').join('\\\\').split('"').join('\\"') + '"';
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
    const lc = s.toLowerCase();
    const a = lc.indexOf('<updatevariable');
    if (a < 0) return null;
    const b = lc.indexOf('</updatevariable>', a);
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
    // RFC 6902 + 本项目自己的扩展 op（delta/insert 由 applyVarOps 消费，别把自家语法判成非法）
    const LANGS_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test', 'delta', 'insert']);
    for (const o of parsed.ops) {
        if (!o.op) problems.push('缺少 op');
        else if (!LANGS_OPS.has(String(o.op))) problems.push('未知 op: ' + o.op);
        if (!o.path && o.op !== 'move') problems.push('缺少 path');
        if (o.op === 'move' && !o.from) problems.push('move 缺少 from');
        if (o.op === 'move' && o.from && o.path && (String(o.path) === String(o.from) || String(o.path).startsWith(String(o.from) + '/') || String(o.from).startsWith(String(o.path) + '/'))) problems.push('move 的 from/path 互为祖先，语义不明确');
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
        // 只在「标签名后跟空白/行尾」时才算缺 > 的畸形闭合；原 (?!>) 会把合法的 </StatusBar> 改成 </Status>Bar>
        const re = new RegExp('</' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s]|$)', 'g');
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
 * 0.10.0：解析角色卡的 [InitVar] 条目（MVU 的变量初始化）→ stat_data。
 * 只支持 MVU 卡实际用到的 YAML 子集：缩进嵌套映射、`- ` 列表、数字/布尔/字符串、块标量 | 与 >。
 * 不支持的写法（锚点/引用/多文档）跳过那一行 —— 宁可少一个字段，也不要解析出错误结构。
 * @returns {object}
 */
export function parseInitVar(text) {
    const root = {};
    const stack = [{ indent: -1, obj: root, parent: null, key: null }];
    const lines = String(text || '').split(/\r?\n/);
    const scalar = (v) => {
        const s = String(v).trim();
        if (s === '') return '';
        if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
        if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
        if (/^null$/i.test(s)) return null;
        let t = s;
        if (t.length > 1 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) t = t.slice(1, -1);
        return t;
    };
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const body = raw.trim();
        if (!body || body[0] === '#' || body === '---' || body.indexOf(String.fromCharCode(96).repeat(3)) === 0) continue;
        const indent = raw.length - raw.replace(/^\s+/, '').length;
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
        const top = stack[stack.length - 1];
        if (body.indexOf('- ') === 0 || body === '-') {
            const v = scalar(body.slice(1).trim());
            let arr = top.obj;
            if (!Array.isArray(arr)) {
                const nn = [];
                if (top.parent && top.key !== null) { top.parent[top.key] = nn; stack[stack.length - 1].obj = nn; }
                else return root;
                arr = nn;
            }
            arr.push(v);
            continue;
        }
        const m = body.match(/^([^:]+):\s*(.*)$/);
        if (!m) continue;
        const key = m[1].trim();
        const val = m[2].trim();
        if (val === '') {
            const child = {};
            top.obj[key] = child;
            stack.push({ indent: indent, obj: child, parent: top.obj, key: key });
            continue;
        }
        if (/^[|>][-+]?$/.test(val)) {
            const raw2 = [];
            let j = i + 1;
            for (; j < lines.length; j++) {
                const l2 = lines[j];
                if (!l2.trim()) { raw2.push(''); continue; }
                const ind2 = l2.length - l2.replace(/^\s+/, '').length;
                if (ind2 <= indent) break;
                raw2.push(l2);
            }
            i = j - 1;
            const ne = raw2.filter((l) => l.trim() !== '');
            const cut = ne.length ? Math.min.apply(null, ne.map((l) => l.length - l.replace(/^\s+/, '').length)) : indent + 1;
            top.obj[key] = raw2.map((l) => (l.trim() === '' ? '' : l.slice(cut))).join(String.fromCharCode(10)).replace(/\s+$/, '');
            continue;
        }
        top.obj[key] = scalar(val);
    }
    return root;
}

/**
 * 0.10.0：解析命令式更新 `_.set(路径, 值)` / `_.assign(路径, 键?, 值)` / `_.add(路径, 增量)` / `_.remove(路径, 键?)`
 * → 统一的 op 列表（MC房子 那类不用 JSONPatch 的卡）。
 */
const SET_FN_NAMES = new Set(['set', 'assign', 'add', 'remove', 'insert', 'delete', 'move']);
/** 从 pos 起找与 source[pos] 配对的闭合括号（跳过字符串与转义）；找不到返回 -1 */
function matchClosing(source, pos) {
    const open = source[pos], close = open === '(' ? ')' : (open === '{' ? '}' : ']');
    let depth = 0, q = null, esc = false;
    for (let i = pos; i < source.length; i++) {
        const ch = source[i];
        if (q) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'" || ch === String.fromCharCode(96)) { q = ch; continue; }
        if (ch === open) depth++;
        else if (ch === close) { depth--; if (depth === 0) return i; }
    }
    return -1;
}
/** 顶层逗号切分（括号/引号内的逗号不算） */
function splitArgs(source) {
    const out = [];
    let depth = 0, q = null, esc = false, cur = '';
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (q) { cur += ch; if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'" || ch === String.fromCharCode(96)) { q = ch; cur += ch; continue; }
        if (ch === '(' || ch === '{' || ch === '[') { depth++; cur += ch; continue; }
        if (ch === ')' || ch === '}' || ch === ']') { depth--; cur += ch; continue; }
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim() !== '' || out.length) out.push(cur.trim());
    return out.filter((s, i, a) => !(s === '' && i === a.length - 1));
}
/**
 * 解析命令式更新（0.14.0 重写：括号配对 + 顶层逗号切分，支持嵌套括号）
 *   `_.set(路径, 值)` / `_.assign(路径, 键?, 值)` / `_.add(路径, 增量)` / `_.remove|delete(路径[, 键])` / `_.insert(路径, 值)` / `_.move(从, 到)`
 * 旧实现用 /_\.(set|assign|add|remove)\(([^)]*)\)/ —— `Number(基础值)` 这种嵌套会在第一个 ) 处截断，写出 `"Number(基础值"`。
 */
export function parseSetCommands(text) {
    const ops = [];
    const src = String(text || '');
    const callRe = /_\s*\.\s*([A-Za-z]+)\s*\(/g;
    let m;
    const clean = (s) => {
        let t = String(s || '').trim();
        if (t.length > 1 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) t = t.slice(1, -1);
        t = t.split(String.fromCharCode(96)).join('');
        return t.trim();
    };
    const val = (s) => {
        const t = clean(s);
        if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
        if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
        if (t === 'null') return null;
        return t;
    };
    while ((m = callRe.exec(src))) {
        const fnName = String(m[1]).toLowerCase();
        if (!SET_FN_NAMES.has(fnName)) continue;
        const openIdx = callRe.lastIndex - 1;
        const closeIdx = matchClosing(src, openIdx);
        if (closeIdx < 0) break;
        const args = splitArgs(src.slice(openIdx + 1, closeIdx));
        callRe.lastIndex = closeIdx + 1;
        const path = clean(args[0]);
        if (!path) continue;
        if (fnName === 'set') ops.push({ op: 'replace', path: path, value: val(args[1]) });
        else if (fnName === 'add') ops.push({ op: 'delta', path: path, value: val(args[1]) });
        else if (fnName === 'assign') {
            if (args.length >= 3) ops.push({ op: 'replace', path: path + '.' + clean(args[1]), value: val(args[2]) });
            else ops.push({ op: 'insert', path: path, value: val(args[1]) });
        } else if (fnName === 'insert') ops.push({ op: 'insert', path: path, value: val(args[1]) });
        else if (fnName === 'move') ops.push({ op: 'move', from: path, path: clean(args[1]) });
        else ops.push({ op: 'remove', path: path + (args[1] ? '.' + clean(args[1]) : '') });
    }
    return ops;
}

/**
 * 0.10.0：把 op 列表应用到一份 stat_data 上（不改原对象）。支持 replace / delta / insert / remove / move；
 * 路径接受 /a/b 与 a.b；父路径不存在就跳过并记账（不猜、不建奇怪的中间层）。
 * @param {boolean} skipDeltas 只跳过 delta（0.12.0 的透支保护会把整楼 delta 都跳掉）
 * @returns {{state:object, applied:string[], skipped:Array<{path:string,reason:string}>}}
 */
function runVarOps(state, ops, opts = {}, skipDeltas = false) {
    const out = (state && typeof state === 'object') ? JSON.parse(JSON.stringify(state)) : {};
    const applied = [], skipped = [], schemaHits = [];
    let aborted = false, tested = 0;   // test 失败即中止；tested 统计通过次数
    const schemaOn = opts.schemaGuard !== false;
    const segs = (p) => unwrapPathWrapper(p).replace(/^\//, '').split(/[\/.]/).filter((s) => s !== '');
    const ruleFor = (arr, segsArr) => { for (const r of (arr || [])) if (pathMatches(segsArr, r.path)) return r; return null; };
    const inObjects = (segsArr) => { for (const p of (opts.objects || [])) if (pathMatches(segsArr, p)) return true; return false; };
    /** 夹取区间 = 所有命中规则的交集（_.clamp 与 .min/.max/.nonnegative 一起算） */
    const clampRange = (segsArr) => {
        let lo = -Infinity, hi = Infinity, hit = false;
        for (const r of (opts.clamps || [])) if (pathMatches(segsArr, r.path)) { lo = Math.max(lo, r.min); hi = Math.min(hi, r.max); hit = true; }
        for (const r of (opts.bounds || [])) if (pathMatches(segsArr, r.path)) { lo = Math.max(lo, r.min); hi = Math.min(hi, r.max); hit = true; }
        return hit ? { lo: lo, hi: hi } : null;
    };
    const clampOf = (segsArr, v) => {
        if (typeof v !== 'number') return v;
        const r = clampRange(segsArr);
        return r ? Math.min(Math.max(v, r.lo), r.hi) : v;
    };
    const coerceTo = (prev, v) => {
        if (opts.coerce === false) return v;
        if (typeof v === 'string' && typeof prev === 'number') { const n = Number(v.trim()); return Number.isFinite(n) ? n : v; }
        if (typeof v === 'string' && typeof prev === 'boolean' && /^(true|false)$/i.test(v.trim())) return /^true$/i.test(v.trim());
        return v;
    };
    /** 按卡的 schema 规范化写入值（类型 + z.coerce 语义）；不合规返回 ok:false 并记账 */
    const check = (segsArr, prev, v, rawPath) => {
        const t = schemaOn ? ruleFor(opts.types, segsArr) : null;
        const forceNum = schemaOn && !!(ruleFor(opts.coerces, segsArr) || ruleFor(opts.rounds, segsArr) || ruleFor(opts.ints, segsArr));
        let value = v;
        if (t) {
            if (t.type === 'number') {
                if (typeof v === 'number' && Number.isFinite(v)) value = v;
                else if (typeof v === 'string' && (t.coerce || forceNum)) { const s2 = v.trim(); const n = Number(s2); if (s2 !== '' && Number.isFinite(n)) value = n; else return fail(segsArr, rawPath, '需要 number，取不到数字'); }
                else if (typeof v === 'boolean' && (t.coerce || forceNum)) value = v ? 1 : 0;
                else return fail(segsArr, rawPath, '需要 number（本卡 schema）');
            } else if (t.type === 'string') {
                if (typeof v === 'string') value = v;
                else if (t.coerce) value = (v === null || v === undefined) ? '' : String(v);
                else return fail(segsArr, rawPath, '需要 string（本卡 schema）');
            } else if (t.type === 'boolean') {
                if (typeof v === 'boolean') value = v;
                else if (typeof v === 'string' && t.coerce && /^(true|false)$/i.test(v.trim())) value = /^true$/i.test(v.trim());
                else return fail(segsArr, rawPath, '需要 boolean（本卡 schema）');
            }
        } else {
            value = coerceTo(prev, v);
        }
        // transform 白名单：Math.floor/round/trunc 与 .int() 都按「取整」处理（对齐 MVU 的 transform 意图）
        const rd = schemaOn ? ruleFor(opts.rounds, segsArr) : null;
        if (rd && typeof value === 'number') value = rd.mode === 'floor' ? Math.floor(value) : (rd.mode === 'round' ? Math.round(value) : Math.trunc(value));
        if (schemaOn && ruleFor(opts.ints, segsArr) && typeof value === 'number' && !Number.isInteger(value)) value = Math.round(value);
        const e = schemaOn ? ruleFor(opts.enums, segsArr) : null;
        if (e) {
            const vals = e.values || [];
            if (!vals.some((x) => x === value || String(x) === String(value))) return fail(segsArr, rawPath, '取值必须是 ' + vals.join(' / ') + ' 之一');
        }
        return { ok: true, v: value };
    };
    /** 不合规时：卡里写了 .catch(x) 就用 x（zod 的 catch 语义），否则跳过并记账 */
    const fail = (segsArr, rawPath, why) => {
        const c = schemaOn ? ruleFor(opts.catches, segsArr) : null;
        if (c) return { ok: true, v: c.value, caught: true };
        skipped.push({ path: String(rawPath), reason: 'schema: ' + why });
        schemaHits.push({ path: String(rawPath), reason: why });
        return { ok: false, why: why };
    };
    const seek = (segsArr, create) => {
        let node = out;
        for (let i = 0; i < segsArr.length; i++) {
            const s = segsArr[i];
            if (node[s] === undefined || node[s] === null || typeof node[s] !== 'object') {
                if (!create) return null;
                // 只有 schema 明确说这里是对象才敢建（没 schema 信息时退回旧行为）
                if (schemaOn && (opts.objects || []).length && !inObjects(segsArr.slice(0, i + 1))) return null;
                node[s] = {};
            }
            node = node[s];
        }
        return node;
    };
    for (let oi = 0; oi < (ops || []).length; oi++) {
        const op = ops[oi];
        const kind = String((op && op.op) || '').toLowerCase();
        const path = segs(op && op.path);
        if (!path.length) { skipped.push({ path: String((op && op.path) || ''), reason: '空路径' }); continue; }
        if (skipDeltas && kind === 'delta') { skipped.push({ path: String(op.path), reason: '整楼 delta 已跳过（防透支保护）' }); continue; }
        // RFC 6902：test 失败即中止后续（但不回滚已应用的 op，与 MVU 行为一致）
        if (aborted) { skipped.push({ path: String(op.path), reason: '前一个 test 未通过，已中止后续' }); continue; }
        const head = path.slice(0, -1);
        const last = path[path.length - 1];
        try {
            if (kind === 'replace') {
                const parent = seek(head, false);
                if (!parent) { skipped.push({ path: String(op.path), reason: '父路径不存在' }); continue; }
                const ck = check(path, parent[last], op.value, op.path);
                if (!ck.ok) continue;
                parent[last] = clampOf(path, ck.v);
            } else if (kind === 'add') {
                // RFC 6902：数组必须用 splice 插入（原先 add 与 replace 同义 → 数组元素被覆盖而不是插入）
                const parent = seek(head, false);
                if (!parent) { skipped.push({ path: String(op.path), reason: '父路径不存在' }); continue; }
                if (Array.isArray(parent)) {
                    const ck0 = check(path, undefined, op.value, op.path);
                    if (!ck0.ok) continue;
                    const v2 = clampOf(path, ck0.v);
                    if (last === '-') parent.push(v2);
                    else if (/^\d+$/.test(last)) { const i2 = Number(last); if (i2 > parent.length) parent.push(v2); else parent.splice(i2, 0, v2); }
                    else { skipped.push({ path: String(op.path), reason: 'add 到数组的下标非法（应为数字或 -）' }); continue; }
                } else {
                    const ck1 = check(path, parent[last], op.value, op.path);
                    if (!ck1.ok) continue;
                    parent[last] = clampOf(path, ck1.v);
                }
            } else if (kind === 'copy') {
                const from = segs(op.from);
                const srcP = from.length ? seek(from.slice(0, -1), false) : null;
                if (!srcP) { skipped.push({ path: String(op.path), reason: 'copy 源路径不存在' }); continue; }
                const v0 = srcP[from[from.length - 1]];
                if (v0 === undefined) { skipped.push({ path: String(op.path), reason: 'copy 源路径没有值' }); continue; }
                const ckC = check(path, undefined, JSON.parse(JSON.stringify(v0)), op.path);
                if (!ckC.ok) continue;
                const parentC = seek(head, false);
                if (!parentC) { skipped.push({ path: String(op.path), reason: '父路径不存在' }); continue; }
                if (Array.isArray(parentC)) {
                    const vc = clampOf(path, ckC.v);
                    if (last === '-') parentC.push(vc);
                    else if (/^\d+$/.test(last)) { const i3 = Number(last); if (i3 > parentC.length) parentC.push(vc); else parentC.splice(i3, 0, vc); }
                    else { skipped.push({ path: String(op.path), reason: 'copy 到数组的下标非法' }); continue; }
                } else parentC[last] = clampOf(path, ckC.v);
            } else if (kind === 'test') {
                const parentT = seek(head, false);
                if (!parentT) { skipped.push({ path: String(op.path), reason: 'test 路径不存在' }); continue; }
                const ckT = check(path, parentT[last], op.value, op.path);
                const aT = stableStringify(parentT[last]), bT = stableStringify(ckT.ok ? ckT.v : op.value);
                if (aT !== bT) {
                    skipped.push({ path: String(op.path), reason: 'test 未通过（当前 ' + aT.slice(0, 40) + '，期望 ' + bT.slice(0, 40) + '）' });
                    aborted = true;
                    continue;
                }
                tested++;
            } else if (kind === 'delta') {
                const parent = seek(head, false);
                if (!parent) { skipped.push({ path: String(op.path), reason: '父路径不存在' }); continue; }
                const cur = parent[last];
                const ck = check(path, cur, op.value, op.path);
                if (!ck.ok) continue;
                if (typeof cur !== 'number' || typeof ck.v !== 'number') { skipped.push({ path: String(op.path), reason: 'delta 需要两边都是数字' }); continue; }
                parent[last] = clampOf(path, cur + ck.v);
            } else if (kind === 'insert') {
                const parent = seek(head, true);
                if (!parent) { skipped.push({ path: String(op.path), reason: '父路径不可建（schema 未声明为对象）' }); continue; }
                if (Array.isArray(parent)) {
                    const ckArr = check(path, 0, op.value, op.path);
                    if (!ckArr.ok) continue;
                    const iv2 = clampOf(path, ckArr.v);
                    if (last === '-' || !/^\d+$/.test(last)) parent.push(iv2);
                    else parent.splice(Number(last), 0, iv2);
                } else {
                    if (parent[last] !== undefined) { skipped.push({ path: String(op.path), reason: 'insert 目标已存在（用 replace）' }); continue; }
                    const ck = check(path, undefined, op.value, op.path);
                    if (!ck.ok) continue;
                    parent[last] = clampOf(path, ck.v);
                }
            } else if (kind === 'remove') {
                const parent = seek(head, false);
                if (!parent) { skipped.push({ path: String(op.path), reason: '父路径不存在' }); continue; }
                if (Array.isArray(parent) && /^\d+$/.test(last)) parent.splice(Number(last), 1);
                else delete parent[last];
            } else if (kind === 'move') {
                const from = segs(op.from);
                const src = from.length ? seek(from.slice(0, -1), false) : null;
                if (!src) { skipped.push({ path: String(op.path), reason: 'move 源路径不存在' }); continue; }
                const fLast = from[from.length - 1];
                const val = src[fLast];
                const ck = check(path, val, val, op.path);
                if (!ck.ok) continue;
                // 先确认目标可建再删源：原先先 delete 再 seek，目标建不出来时源值已经没了，却只记一条 skipped
                const dst = seek(head, true);
                if (!dst) { skipped.push({ path: String(op.path), reason: 'move 目标不可建' }); continue; }
                delete src[fLast];
                dst[last] = clampOf(path, ck.v);
            } else { skipped.push({ path: String(op.path), reason: '未知 op ' + kind }); continue; }
            applied.push(String(op.path));
        } catch (e) { skipped.push({ path: String(op && op.path), reason: String((e && e.message) || e) }); }
    }
    return { state: out, applied: applied, skipped: skipped, schemaHits: schemaHits, tested: tested, aborted: aborted };
}

/**
 * 0.12.1：按 schema 的 prefault/default 补上缺失字段（模拟 MVU 的 zod 初始化语义）。
 * 只补「当前是 undefined」的叶子，绝不覆盖已有值；解析不出来的默认值跳过。
 */
export function fillSchemaDefaults(state, defaults) {
    const out = (state && typeof state === 'object') ? JSON.parse(JSON.stringify(state)) : {};
    for (const d of (defaults || [])) {
        const segsArr = d.path || [];
        if (!segsArr.length) continue;
        const val = d.value;
        if (val && typeof val === 'object' && !Array.isArray(val) && val.__unparsed !== undefined) continue;
        let node = out, ok = true;
        for (let i = 0; i < segsArr.length - 1; i++) {
            const s = segsArr[i];
            if (node[s] === undefined) node[s] = {};
            if (node[s] === null || typeof node[s] !== 'object') { ok = false; break; }
            node = node[s];
        }
        if (!ok) continue;
        const last = segsArr[segsArr.length - 1];
        if (node[last] === undefined) node[last] = (val === null) ? null : JSON.parse(JSON.stringify(val));
    }
    return out;
}

/**
 * 0.12.0：把一份状态里「变成负数、但初值本来是非负数」的数值字段列出来。
 * 用来发现两类问题：① 引擎/ MVU 把金额扣成了负数（实测「现金 500 被扣 2500 → -2000」）；
 * ② 历史楼层里已经写坏的旧值，需要重算修回来。
 * @returns {string[]} 点分路径，例如 ['林婉婷.经济.现金']
 */
export function negativeFields(state, initState) {
    const out = [];
    const walk = (node, path) => {
        if (node == null || typeof node !== 'object') return;
        for (const k of Object.keys(node)) {
            const v = node[k];
            const p = path.concat([k]);
            if (typeof v === 'number') {
                if (v < 0) {
                    const iv = valueAtPath(initState, p.join('.'));
                    if (typeof iv === 'number' && iv >= 0) out.push(p.join('.'));
                }
            } else if (v && typeof v === 'object') walk(v, p);
        }
    };
    if (state && typeof state === 'object') walk(state, []);
    return out;
}

/**
 * 0.12.0：收支保护（实测「破产后姐姐…」的金钱错误）。
 * 病灶：第 3 楼（无补丁，MVU 自己算的）已经把 欠款 3000→500、累计支出 0→2500 记过一次；
 * 第 5 楼的补丁又写了 delta 现金 -2500 / delta 累计支出 +2500，且此前 MVU 没应用。
 * 如果照单全收，现金 500 会被扣成 -2000 —— 明显不可能的数值。
 *
 * 规则（可关：{ overdraftGuard: false }）：
 *   ① 先正常算一遍；
 *   ② 若结果里出现「初值为非负、结果却变负」的数值字段，就认为**这一楼补丁的算术与真实余额不自洽**
 *      （模型是按另一套余额算的），于是整楼的 delta 一律不应用，只应用 replace / insert / remove；
 *   ③ 被拦下的路径记在 guardHit，交给面板/日志提示，绝不静默。
 * 这样第 5 楼剩下来自 replace 的 时间/地点/心情/表情，金额保持 现金 500 / 累计支出 2500（不重复计费）。
 * @returns {{state:object, applied:string[], skipped:Array, guardHit:string[]}}
 */
export function applyVarOps(state, ops, opts = {}) {
    let r = runVarOps(state, ops, opts, false);
    if (opts.overdraftGuard === false) return r;
    const hit = negativeFields(r.state, state);
    if (!hit.length) return r;
    const r2 = runVarOps(state, ops, opts, true);
    r2.skipped = r2.skipped.concat(hit.map((p) => ({ path: p, reason: '会让数值变成负数 → 整楼 delta 已跳过（防扣款错误）' })));
    r2.guardHit = hit;
    r2.schemaHits = (r.schemaHits || []).concat(r2.schemaHits || []);
    return r2;
}

/* ── 0.12.1：MVU Zod schema 静态解析 v2 ──────────────────────────────
 * 旧版是「缩进栈 + 逐行正则」，实测在真实卡上会丢父路径：处理 }).prefault({}), 时
 * while(indent<=top.indent) 已经弹过一次栈，紧跟的 if(/^\s*\}/) 又弹一次 →
 * 关系态度 的父级 林婉婷/陈慧兰 被弹掉，4 处 _.clamp 全变成裸路径，
 * pathMatches 长度不等 → 夹取规则永不命中。也认不出 const X = z.object({...}) 的
 * helper 引用、z.record(z.enum([...]), X)、.prefault()/.default()、z.enum()。
 * 本版改成「剥注释（字符串感知）→ 收集 const 定义 → 从根 z.object 括号配对递归下降」，
 * 路径始终完整。拿不到的东西（.refine/.custom/.pipe、非 _.clamp 的 .transform、
 * 动态 schema / 计算键 / 展开）不假装能校验，统一记进 unverifiable，由面板与日志显式提示。
 * @returns {{clamps,bounds,types,enums,defaults,optional,objects,records,unverifiable,helpers}}
 */

/** JS 合法标识符（含中文），用于区分「helper 引用」与「内联表达式」 */
const IDENT_RE = /^[A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*$/;

/** 剥掉 JS 注释（字符串内的 // 与 /* 原样保留） */
function stripJsComments(src) {
    const s = String(src == null ? '' : src);
    const NL = String.fromCharCode(10);
    let out = '', i = 0, quote = '';
    while (i < s.length) {
        const c = s[i], d = s[i + 1];
        if (quote) {
            out += c;
            if (c === '\\') { out += (d || ''); i += 2; continue; }
            if (c === quote) quote = '';
            i += 1; continue;
        }
        if (c === '"' || c === "'") { quote = c; out += c; i += 1; continue; }
        if (c === '/' && d === '/') { while (i < s.length && s[i] !== NL) i += 1; continue; }
        if (c === '/' && d === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1; i += 2; continue; }
        out += c; i += 1;
    }
    return out;
}

/** 从 open（{ ( [）找配对闭括号下标；字符串感知；找不到返回 -1 */
function matchBracket(src, open) {
    const s = String(src || '');
    const ch = s[open];
    const pair = ch === '{' ? '}' : (ch === '(' ? ')' : (ch === '[' ? ']' : ''));
    if (!pair) return -1;
    let depth = 0, i = open, quote = '';
    while (i < s.length) {
        const c = s[i];
        if (quote) {
            if (c === '\\') { i += 2; continue; }
            if (c === quote) quote = '';
            i += 1; continue;
        }
        if (c === '"' || c === "'") { quote = c; i += 1; continue; }
        if (c === ch) depth += 1;
        else if (c === pair) { depth -= 1; if (!depth) return i; }
        i += 1;
    }
    return -1;
}

/** 按顶层分隔符切分（括号内与字符串内的分隔符忽略） */
function splitTop(src, sep) {
    const s = String(src || '');
    const out = [];
    let cur = '', depth = 0, quote = '', i = 0;
    while (i < s.length) {
        const c = s[i];
        if (quote) { cur += c; if (c === '\\') { cur += (s[i + 1] || ''); i += 2; continue; } if (c === quote) quote = ''; i += 1; continue; }
        if (c === '"' || c === "'") { quote = c; cur += c; i += 1; continue; }
        if (c === '{' || c === '(' || c === '[') depth += 1;
        else if (c === '}' || c === ')' || c === ']') depth -= 1;
        if (c === sep && depth === 0) { out.push(cur); cur = ''; i += 1; continue; }
        cur += c; i += 1;
    }
    out.push(cur);
    return out;
}

/** 从 idx 起取一条语句（顶层 ; 或换行结束） */
function takeStatement(src, idx) {
    const s = String(src || '');
    const NL = String.fromCharCode(10);
    let depth = 0, quote = '', i = idx;
    while (i < s.length) {
        const c = s[i];
        if (quote) { if (c === '\\') { i += 2; continue; } if (c === quote) quote = ''; i += 1; continue; }
        if (c === '"' || c === "'") { quote = c; i += 1; continue; }
        if (c === '{' || c === '(' || c === '[') depth += 1;
        else if (c === '}' || c === ')' || c === ']') depth -= 1;
        else if (depth <= 0 && (c === ';' || c === NL)) break;
        i += 1;
    }
    return s.slice(idx, i);
}

/** 找 z.object( / z.strictObject( / z.looseObject( 的**字面量**对象体；动态参数返回 null */
function findObjectCall(src) {
    const s = String(src || '');
    const m = /z\s*\.\s*(?:strict|loose)?[oO]bject\s*\(/.exec(s);
    if (!m) return null;
    const open = s.indexOf('(', m.index);
    const close = matchBracket(s, open);
    if (close < 0) return null;
    const arg = s.slice(open + 1, close).trim();
    if (arg[0] !== '{') return null;
    const end = arg.lastIndexOf('}');
    if (end < 0) return null;
    return { body: arg.slice(1, end), tail: s.slice(close + 1) };
}

/** 解析对象体里的键值对；展开/计算键记进 ctx.unverifiable */
function parseObjectEntries(body, ctx, path) {
    const out = [];
    for (const raw of splitTop(body, ',')) {
        const t = raw.trim();
        if (!t) continue;
        if (t.indexOf('...') === 0) { if (ctx) ctx.unverifiable.push({ path: path.slice(), kind: 'spread' }); continue; }
        const m = t.match(/^(?:'([^']*)'|"([^"]*)"|([A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*))\s*:\s*([\s\S]+)$/);
        if (!m) { if (ctx && t[0] === '[') ctx.unverifiable.push({ path: path.slice(), kind: 'computed-key' }); continue; }
        const key = (m[1] !== undefined) ? m[1] : ((m[2] !== undefined) ? m[2] : m[3]);
        out.push({ key: key, value: m[4].trim() });
    }
    return out;
}

/** JS 字面量 → 值；解析不了返回 { __unparsed: 原文 } */
function jsLiteral(s) {
    const t = String(s == null ? '' : s).trim();
    if (!t) return { __unparsed: t };
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
    if (/^'(?:[^'\\]|\\.)*'$/.test(t) || /^"(?:[^"\\]|\\.)*"$/.test(t)) return t.slice(1, -1);
    try { return JSON.parse(t); } catch (_) {}
    try {
        const q = t.replace(/'/g, '"')
            .replace(/([{,]\s*)([A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*)\s*:/g, '$1"$2":')
            .replace(/,(\s*[}\]])/g, '$1');
        return JSON.parse(q);
    } catch (_) {}
    return { __unparsed: t };
}

/** 取某个调用（idx 处）括号内的参数，按顶层逗号切开 */
function callArgs(src, idx) {
    const s = String(src || '');
    const open = s.indexOf('(', idx);
    if (open < 0) return [];
    const close = matchBracket(s, open);
    if (close < 0) return [];
    return splitTop(s.slice(open + 1, close), ',').map((a) => a.trim()).filter((a) => a !== '');
}

/** zod 类型判定 → { type, coerce } 或 null */
function zodTypeOf(expr) {
    const s = String(expr || '');
    if (/z\s*\.\s*(?:strict|loose)?[oO]bject\s*\(/.test(s)) return { type: 'object', coerce: false };
    if (/z\s*\.\s*record\s*\(/.test(s)) return { type: 'object', coerce: false };
    if (/z\s*\.\s*array\s*\(/.test(s)) return { type: 'array', coerce: false };
    if (/z\s*\.\s*enum\s*\(/.test(s)) return { type: 'enum', coerce: false };
    if (/z\s*\.\s*literal\s*\(/.test(s)) return { type: 'literal', coerce: false };
    if (/z\s*\.\s*union\s*\(/.test(s)) return { type: 'union', coerce: false };
    const c = /z\s*\.\s*(coerce\s*\.\s*)?(number|string|bool(?:ean)?)\s*\(/.exec(s);
    if (c) {
        const coerce = !!(c[1] && c[1].trim());
        const name = c[2].toLowerCase();
        return { type: (name === 'bool' || name === 'boolean') ? 'boolean' : name, coerce: coerce };
    }
    return null;
}

/** 枚举取值：z.enum([...]) / z.literal(x) / 全字面量 z.union([...]) */
function zodEnumOf(expr) {
    const s = String(expr || '');
    const m = /z\s*\.\s*enum\s*\(/.exec(s);
    if (m) {
        const raw = (callArgs(s, m.index)[0] || '').trim();
        const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
        const vals = splitTop(inner, ',').map((x) => jsLiteral(x)).filter((v) => typeof v === 'string' || typeof v === 'number');
        if (vals.length) return vals;
    }
    if (/z\s*\.\s*union\s*\(/.test(s)) {
        const um = /z\s*\.\s*union\s*\(/.exec(s);
        const raw = (callArgs(s, um.index)[0] || '').trim().replace(/^\[/, '').replace(/\]$/, '');
        const parts = splitTop(raw, ',').map((x) => x.trim());
        const vals = [];
        let allLiteral = parts.length > 0;
        for (const p of parts) {
            const lm = /z\s*\.\s*literal\s*\(/.exec(p);
            if (!lm) { allLiteral = false; break; }
            const v = jsLiteral(callArgs(p, lm.index)[0] || '');
            if (typeof v === 'string' || typeof v === 'number') vals.push(v); else { allLiteral = false; break; }
        }
        if (allLiteral && vals.length) return vals;
    }
    const lm2 = /z\s*\.\s*literal\s*\(/.exec(s);
    if (lm2) {
        const v = jsLiteral(callArgs(s, lm2.index)[0] || '');
        if (typeof v === 'string' || typeof v === 'number') return [v];
    }
    return null;
}

/** 记录一个字段（或对象本身）上的全部约束 */
function recordSchemaConstraints(expr, path, ctx) {
    const s = String(expr || '');
    const clamp = /_.clamp\(\s*[^,()]+\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(s);
    if (clamp) ctx.clamps.push({ path: path.slice(), min: Number(clamp[1]), max: Number(clamp[2]), from: '_.clamp' });
    const ty = zodTypeOf(s);
    if (ty && ty.type === 'number') {
        let lo = null, hi = null;
        const mn = /\.\s*min\(\s*(-?[\d.]+)\s*\)/.exec(s);
        const mx = /\.\s*max\(\s*(-?[\d.]+)\s*\)/.exec(s);
        if (mn) lo = Number(mn[1]);
        if (mx) hi = Number(mx[1]);
        if (/\.\s*nonnegative\s*\(/.test(s)) lo = (lo === null) ? 0 : Math.max(lo, 0);
        if (/\.\s*positive\s*\(/.test(s)) lo = (lo === null) ? 0 : Math.max(lo, 0);
        if (lo !== null || hi !== null) ctx.bounds.push({ path: path.slice(), min: lo === null ? -Infinity : lo, max: hi === null ? Infinity : hi, from: 'minmax' });
        if (/\.\s*int\s*\(/.test(s)) ctx.ints.push(path.slice());
    }
    const cm = /\.\s*catch\s*\(/g;
    let cmMatch, cmGuard = 0;
    while ((cmMatch = cm.exec(s)) && cmGuard < 10) {
        cmGuard += 1;
        const open = s.indexOf('(', cmMatch.index);
        const close = matchBracket(s, open);
        if (close < 0) break;
        const v = jsLiteral(s.slice(open + 1, close));
        if (!(v && typeof v === 'object' && !Array.isArray(v) && v.__unparsed !== undefined)) ctx.catches.push({ path: path.slice(), value: v });
        cm.lastIndex = close;
    }
    const pm = /\.\s*(?:prefault|default)\s*\(/g;
    let pmMatch, guard = 0;
    while ((pmMatch = pm.exec(s)) && guard < 20) {
        guard += 1;
        const open = s.indexOf('(', pmMatch.index);
        const close = matchBracket(s, open);
        if (close < 0) break;
        const v = jsLiteral(s.slice(open + 1, close));
        if (v && typeof v === 'object' && !Array.isArray(v) && v.__unparsed !== undefined) ctx.unverifiable.push({ path: path.slice(), kind: 'dynamic-default' });
        else ctx.defaults.push({ path: path.slice(), value: v });
        pm.lastIndex = close;
    }
    if (/\.\s*(?:optional|nullish|nullabe|nullab)\s*\(/.test(s)) ctx.optional.push(path.slice());
    if (/\.\s*(?:refine|superRefine|custom)\s*\(/.test(s)) ctx.unverifiable.push({ path: path.slice(), kind: 'refine' });
    // transform：只认语料里真实出现的白名单写法（clamp / Math.max-min / floor-round-trunc / Number / ?? 默认值），
    // 其它一律记进 unverifiable —— 不假装能执行卡的任意 JS。
    const tf = /\.\s*transform\s*\(/g;
    let tm2, tfGuard = 0;
    while ((tm2 = tf.exec(s)) && tfGuard < 20) {
        tfGuard += 1;
        const open = s.indexOf('(', tm2.index);
        const close = matchBracket(s, open);
        if (close < 0) break;
        const raw = s.slice(open + 1, close);
        tf.lastIndex = close;
        const arrow = raw.indexOf('=>');
        const body = (arrow >= 0 ? raw.slice(arrow + 2) : raw).trim();
        const flat = body.replace(/\s+/g, '');
        let handled = false;
        const cl = /(?:_.clamp|clamp)\([a-zA-Z_$][\w$]*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\)/.exec(flat);
        if (cl) { ctx.clamps.push({ path: path.slice(), min: Number(cl[1]), max: Number(cl[2]), from: 'transform' }); handled = true; }
        const mx = /Math\.max\(\s*(-?[\d.]+)\s*,[a-zA-Z_$][\w$]*\)/.exec(flat) || /Math\.max\([a-zA-Z_$][\w$]*,\s*(-?[\d.]+)\)/.exec(flat);
        if (mx) { ctx.bounds.push({ path: path.slice(), min: Number(mx[1]), max: Infinity, from: 'transform' }); handled = true; }
        const mn = /Math\.min\(\s*(-?[\d.]+)\s*,[a-zA-Z_$][\w$]*\)/.exec(flat) || /Math\.min\([a-zA-Z_$][\w$]*,\s*(-?[\d.]+)\)/.exec(flat);
        if (mn) { ctx.bounds.push({ path: path.slice(), min: -Infinity, max: Number(mn[1]), from: 'transform' }); handled = true; }
        if (/Math\.floor\(/.test(flat)) { ctx.rounds.push({ path: path.slice(), mode: 'floor' }); handled = true; }
        else if (/Math\.round\(/.test(flat)) { ctx.rounds.push({ path: path.slice(), mode: 'round' }); handled = true; }
        else if (/Math\.trunc\(/.test(flat)) { ctx.rounds.push({ path: path.slice(), mode: 'trunc' }); handled = true; }
        if (/^Number\(/.test(flat)) { ctx.coerces.push(path.slice()); handled = true; }
        const qq = body.indexOf('??');
        if (qq >= 0) {
            const dv = jsLiteral(body.slice(qq + 2));
            if (!(dv && typeof dv === 'object' && !Array.isArray(dv) && dv.__unparsed !== undefined)) { ctx.defaults.push({ path: path.slice(), value: dv, nullish: true }); handled = true; }
        }
        if (!handled) ctx.unverifiable.push({ path: path.slice(), kind: 'transform' });
    }
    if (/\.\s*pipe\s*\(/.test(s)) ctx.unverifiable.push({ path: path.slice(), kind: 'pipe' });
    if (/\.\s*check\s*\(/.test(s)) ctx.unverifiable.push({ path: path.slice(), kind: 'check' });
}

/** 展开 helper 引用（带环保护） */
function expandSchemaHelper(name, path, ctx) {
    const gk = path.join('.') + '|' + name;
    if (ctx.expanding.has(gk)) { ctx.unverifiable.push({ path: path.slice(), kind: 'helper-cycle:' + name }); return; }
    ctx.expanding.add(gk);
    const h = ctx.helpers[name];
    if (!h) { ctx.unverifiable.push({ path: path.slice(), kind: 'unknown-ref:' + name }); return; }
    if (h.kind === 'object') {
        ctx.objects.push(path.slice());
        for (const e of h.entries) walkSchemaField(e.key, e.value, path, ctx);
    } else if (h.kind === 'record') {
        expandSchemaRecord(h.expr, path, ctx);
    } else {
        const ex = String(h.expr || '').trim();
        if (!ex) { ctx.unverifiable.push({ path: path.slice(), kind: 'dynamic-ref:' + name }); return; }
        recordSchemaConstraints(ex, path, ctx);
        const ty = zodTypeOf(ex);
        if (ty) ctx.types.push({ path: path.slice(), type: ty.type, coerce: ty.coerce });
        const en = zodEnumOf(ex);
        if (en) ctx.enums.push({ path: path.slice(), values: en });
    }
}

/** 展开 z.record(键, 值)：键是 z.enum([...]) 就逐个展开，否则用通配 * */
function expandSchemaRecord(expr, path, ctx) {
    const s = String(expr || '');
    const m = /z\s*\.\s*record\s*\(/.exec(s);
    if (!m) return;
    const args = callArgs(s, m.index);
    const keyExpr = (args[0] || '').trim();
    const valExpr = args.slice(1).join(',').trim();
    let keys = zodEnumOf(keyExpr);
    if (!keys) {
        if (!keyExpr || /z\s*\.\s*(?:coerce\s*\.\s*)?string\s*\(/.test(keyExpr) || /z\s*\.\s*(?:any|unknown)\s*\(/.test(keyExpr)) keys = ['*'];
        else { ctx.unverifiable.push({ path: path.slice(), kind: 'record-key' }); keys = ['*']; }
    }
    keys = keys.map((k) => String(k));
    ctx.records.push({ path: path.slice(), keys: keys.slice() });
    for (const k of keys) walkSchemaField(k, valExpr, path, ctx);
}

/** 递归走一个字段 */
function walkSchemaField(key, expr, basePath, ctx) {
    const path = basePath.concat([String(key)]);
    const s = String(expr == null ? '' : expr).trim();
    if (!s) return;
    if (IDENT_RE.test(s)) { expandSchemaHelper(s, path, ctx); return; }
    if (/z\s*\.\s*record\s*\(/.test(s)) {
        const rmm = /z\s*\.\s*record\s*\(/.exec(s);
        const ropen = s.indexOf('(', rmm.index);
        const rclose = matchBracket(s, ropen);
        recordSchemaConstraints(rclose >= 0 ? s.slice(rclose + 1) : '', path, ctx);
        expandSchemaRecord(s, path, ctx);
        return;
    }
    const obj = findObjectCall(s);
    if (obj) {
        recordSchemaConstraints(obj.tail, path, ctx);
        ctx.objects.push(path.slice());
        for (const e of parseObjectEntries(obj.body, ctx, path)) walkSchemaField(e.key, e.value, path, ctx);
        return;
    }
    if (/z\s*\.\s*(?:strict|loose)?[oO]bject\s*\(/.test(s)) { recordSchemaConstraints(s, path, ctx); ctx.unverifiable.push({ path: path.slice(), kind: 'dynamic-object' }); return; }
    recordSchemaConstraints(s, path, ctx);
    const ty = zodTypeOf(s);
    if (ty) ctx.types.push({ path: path.slice(), type: ty.type, coerce: ty.coerce });
    const en = (ty && (ty.type === 'enum' || ty.type === 'union' || ty.type === 'literal')) ? zodEnumOf(s) : null;
    if (en) ctx.enums.push({ path: path.slice(), values: en });
    if (ty && ty.type === 'array') {
        const am = /z\s*\.\s*array\s*\(/.exec(s);
        const inner = (callArgs(s, am.index)[0] || '').trim();
        const elemPath = path.concat(['*']);
        if (!inner) ctx.unverifiable.push({ path: elemPath, kind: 'array-elem' });
        else if (IDENT_RE.test(inner) && ctx.helpers[inner]) expandSchemaHelper(inner, elemPath, ctx);
        else {
            const io = findObjectCall(inner);
            if (io) {
                ctx.objects.push(elemPath);
                for (const e of parseObjectEntries(io.body, ctx, elemPath)) walkSchemaField(e.key, e.value, elemPath, ctx);
            } else {
                recordSchemaConstraints(inner, elemPath, ctx);
                const it = zodTypeOf(inner);
                if (it) ctx.types.push({ path: elemPath, type: it.type, coerce: it.coerce });
                else ctx.unverifiable.push({ path: elemPath, kind: 'array-elem' });
            }
        }
    }
}

/** 主入口：把卡里的 Zod schema 源码解析成「可静态执行的约束」+「无法离线校验的清单」 */
export function schemaHints(scriptText) {
    let src = stripJsComments(scriptText).replace(/\bzod\s*\./g, 'z.');
    const ctx = {
        clamps: [], bounds: [], types: [], enums: [], defaults: [], optional: [],
        objects: [], records: [], unverifiable: [], helpers: {}, expanding: new Set(),
        ints: [], catches: [], rounds: [], coerces: [],
    };
    const defRe = /(?:^|[;{}\n])\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*)\s*=\s*/g;
    let dm;
    while ((dm = defRe.exec(src))) {
        const name = dm[1];
        const stmt = takeStatement(src, defRe.lastIndex);
        const o = findObjectCall(stmt);
        if (o) ctx.helpers[name] = { kind: 'object', entries: parseObjectEntries(o.body, null, []), body: o.body };
        else if (/z\s*\.\s*record\s*\(/.test(stmt)) ctx.helpers[name] = { kind: 'record', expr: stmt };
        else ctx.helpers[name] = { kind: 'other', expr: stmt };
    }
    let root = null;
    const rm = /(?:export\s+)?(?:const|let|var)\s+Schema\s*=\s*/.exec(src);
    if (rm) root = findObjectCall(takeStatement(src, rm.index + rm[0].length));
    if (!root) {
        // registerMvuSchema(XXX) → 用 XXX 这个名字查 helper（语料里很常见：statSchema / HaremChar / 角色结构…）
        const names = [];
        const rs = /registerMvuSchema\s*\(\s*([A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*)?/g;
        let rsm;
        while ((rsm = rs.exec(src))) if (rsm[1]) names.push(rsm[1]);
        for (let i = names.length - 1; i >= 0 && !root; i--) {
            const h = ctx.helpers[names[i]];
            if (h && h.kind === 'object' && h.body) root = { body: h.body };
        }
    }
    if (!root) {
        // 退路：取「顶层条目最多」的 z.object 字面量（比取最后一个更稳）
        const all = [];
        const g = /z\s*\.\s*(?:strict|loose)?[oO]bject\s*\(/g;
        let gm;
        while ((gm = g.exec(src))) { const o = findObjectCall(src.slice(gm.index)); if (o) all.push(o); }
        if (all.length) {
            all.sort((a, b) => parseObjectEntries(b.body, null, []).length - parseObjectEntries(a.body, null, []).length);
            root = all[0];
        }
    }
    if (root) {
        for (const e of parseObjectEntries(root.body, ctx, [])) walkSchemaField(e.key, e.value, [], ctx);
    } else {
        ctx.unverifiable.push({ path: [], kind: 'no-root-schema' });
    }
    const uniqBy = (arr, keyOf) => { const seen = new Set(); return arr.filter((x) => { const k = keyOf(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
    return {
        clamps: uniqBy(ctx.clamps, (c) => c.path.join('.') + '|' + c.min + '|' + c.max),
        bounds: uniqBy(ctx.bounds, (c) => c.path.join('.') + '|' + c.min + '|' + c.max),
        types: uniqBy(ctx.types, (t) => t.path.join('.') + '|' + t.type),
        enums: uniqBy(ctx.enums, (e) => e.path.join('.')),
        defaults: uniqBy(ctx.defaults, (d) => d.path.join('.')),
        optional: uniqBy(ctx.optional, (p) => p.join('.')),
        objects: uniqBy(ctx.objects, (p) => p.join('.')),
        records: ctx.records,
        ints: uniqBy(ctx.ints, (p) => p.join('.')).map((p) => ({ path: p })),
        catches: uniqBy(ctx.catches, (c) => c.path.join('.')),
        rounds: uniqBy(ctx.rounds, (r) => r.path.join('.')),
        coerces: uniqBy(ctx.coerces, (p) => p.join('.')).map((p) => ({ path: p })),
        unverifiable: uniqBy(ctx.unverifiable, (u) => u.kind + '|' + u.path.join('.')),
        helpers: Object.keys(ctx.helpers).reduce((m, k) => { m[k] = ctx.helpers[k].kind + (ctx.helpers[k].entries ? ':' + ctx.helpers[k].entries.length : ''); return m; }, {}),
    };
}

/** 路径匹配：'林婉婷.关系态度' 命中规则路径 ['林婉婷','关系态度']（也允许规则里带 * 通配一层） */
export function pathMatches(segs, rulePath) {
    if (!Array.isArray(segs) || !Array.isArray(rulePath) || segs.length !== rulePath.length) return false;
    return rulePath.every((r, i) => r === '*' || String(segs[i]) === String(r));
}

/**
 * 0.11.0：幂等重放 —— 从初值开始，按楼层顺序逐楼应用补丁，返回每一楼的「补丁后状态」。
 * 为什么这样就安全：状态是从 InitVar 重算的，同一批补丁重放多少次结果都一样（delta 也只加一次），
 * 所以 MVU 在场时也能放心自动修，不会二次累加。
 * @returns {Array<{state:object, applied:number, skipped:Array}>}
 */
export function replayFloorStates(initState, floorOpsList, opts) {
    const out = [];
    let cur = (initState && typeof initState === 'object') ? initState : {};
    for (const ops of (floorOpsList || [])) {
        const r = applyVarOps(cur, ops || [], opts);
        cur = r.state;
        out.push({ state: cur, applied: r.applied.length, skipped: r.skipped });
    }
    return out;
}

/**
 * 0.11.0：逐楼决定「这一楼要不要修、修成什么」。这是引擎的核心，也是实测过的安全策略。
 *
 * 为什么不能无脑从 [InitVar] 全量重放写回（本函数存在的原因）：
 * 真实卡「破产后姐姐和美母和我的性交易」第 3 楼**只有 <Analysis> 没有 <JSONPatch>**，
 * 但 MVU 自己的「时间流逝」特性把 系统.时间 从 14:00 推到了 14:15。
 * 靠 [InitVar] 重放根本不知道这 15 分钟，会把第 3/4 楼从 14:15 回退成 14:00 —— 这是写坏数据。
 * 又因为第 5、7 楼的 <JSONPatch> 完全合法（14 个/12 个操作）却没被 MVU 应用，状态栏卡在 14:15。
 *
 * 策略（只修「卡住」的楼层，且以 MVU 的真实值为基线）：
 *   base      = 该楼之前**当前最新**的真实值（我们刚写的值，或 MVU 存的值；都没有才退回 [InitVar]）
 *   want      = base 应用本楼补丁
 *   卡住判据  = 本楼存值与**上一楼原值**一模一样（= 补丁没被应用），或本楼压根没有存值
 *   写回条件  = 卡住 且 want 与现值不同
 * 好处：
 *   ① MVU 已经应用过的楼层**永不覆盖**（存值变了就跳过）；
 *   ② delta 不会二次累加（base 用的是 MVU 的真实当前值，本楼的 delta 只加这一次）；
 *   ③ 我们解析不了的方言 / MVU 自算的字段（时间流逝等）**不会回退**，因为基线就是 MVU 的值；
 *   ④ 幂等：写完再跑一遍，存值已变 → 不再写。
 * @param {Array<object|null>} stored 每楼存下来的 stat_data（没有就 null）
 * @param {Array<Array<object>>} ops 每楼解析出的补丁操作
 * @param {object} initState [InitVar] 初值（MVU 完全不在场时用）
 * 0.12.0 追加：若某楼存值里出现了「初值非负、现值却是负数」的字段（实测 现金 -2000），
 * 就算它「存值变了」，也一律重算修回来（reason = 'negative-fix'）。
 * @returns {Array<{index:number, ops:number, write:boolean, want:object|null, applied:number, skipped:Array, reason:string, negative?:string[], guardHit?:string[]}>}
 */
export function planFloorFixes(stored, ops, initState, opts = {}) {
    const n = (stored || []).length;
    const out = [];
    let base = (initState && typeof initState === 'object') ? initState : {};
    let prevOrig = null;
    let fixedAny = false;   // 修过任何一楼之后，我们自己写的值就是最新真相，后面「没补丁的楼层」的旧快照不许把它盖回去
    for (let i = 0; i < n; i++) {
        const o = (ops && ops[i]) || [];
        const cur = (stored && stored[i]) || null;
        const info = { index: i, ops: o.length, write: false, want: null, applied: 0, skipped: [], reason: 'no-ops' };
        // 0.12.0：已经写坏的楼层（数值被扣成负数）必须重算修回来 —— 否则「存值变了 = MVU 已应用」会把它当成正常状态放过
        const bad = negativeFields(cur, initState);
        if (bad.length) info.negative = bad;
        if (o.length) {
            const r = applyVarOps(base, o, opts);
            // 0.12.1：补上 schema 声明的 prefault 默认值（模拟 MVU 的 zod 初始化，只补 undefined）
            const want = (opts.defaults && opts.fillDefaults !== false) ? fillSchemaDefaults(r.state, opts.defaults) : r.state;
            info.want = want;
            info.applied = r.applied.length;
            info.skipped = r.skipped;
            if (r.guardHit) info.guardHit = r.guardHit;
            if (r.schemaHits && r.schemaHits.length) info.schemaHits = r.schemaHits;
            const stuck = cur ? (prevOrig ? stableStringify(cur) === stableStringify(prevOrig) : false) : true;
            if (bad.length && stableStringify(cur) !== stableStringify(want)) { info.write = true; info.reason = 'negative-fix'; }
            else if (stuck && stableStringify(cur) !== stableStringify(want)) { info.write = true; info.reason = 'stuck'; }
            else if (stuck) info.reason = 'already-correct';
            else info.reason = 'mvu-applied';
            base = info.write ? want : (cur || want);
        } else if (cur) {
            if (bad.length && stableStringify(cur) !== stableStringify(base)) {
                // 没有补丁的楼层（含 user 快照）带着坏数值 → 用当前最新真相覆盖它
                info.write = true; info.reason = 'negative-fix'; info.want = base;
            } else {
                // 没补丁的楼层（含 user 楼层——实测 ST 也会给 user 快照）：
                // 只有在我们还没修过任何楼层、或者 MVU 自己往前推了（时间流逝等）时才采纳它的快照。
                const advanced = prevOrig ? stableStringify(cur) !== stableStringify(prevOrig) : false;
                if (!fixedAny || advanced) base = cur;
            }
        }
        if (cur) prevOrig = cur;
        if (info.write) fixedAny = true;
        out.push(info);
    }
    return out;
}

/**
 * 0.11.0：探测模板读的是哪个 scope（写变量时要写到对的地方）。
 * message（默认，MVU 同款）/ chat / character。
 * @returns {{scope:'message'|'chat'|'character', reason:string}}
 */
export function detectVarScope(text) {
    const t = String(text || '');
    // 先按精确的 type 值判定（all_variables / getvar 都是弱信号：渲染模板里很常见，卡实际可能写 character/chat 变量）
    const tMessage = /getVariables\s*\(\s*\{[^}]*type\s*:\s*['"]message/i.test(t);
    const tChar = /getVariables\s*\(\s*\{[^}]*type\s*:\s*['"]character/i.test(t);
    const tChat = /getVariables\s*\(\s*\{[^}]*type\s*:\s*['"]chat/i.test(t);
    if (tChar) return { scope: 'character', reason: 'character 变量' };
    if (tChat) return { scope: 'chat', reason: 'chat 变量' };
    if (tMessage) return { scope: 'message', reason: 'message 变量（与 MVU 同处）' };
    if (/all_variables/.test(t)) return { scope: 'message', reason: '弱信号：all_variables（无精确 type 时的保守选择，与 MVU 一致）' };
    if (/getVariables\s*\(\s*\{[^}]*type\s*:\s*['"]message/i.test(t)) return { scope: 'message', reason: 'message 变量' };
    if (/getVariables\s*\(\s*\{[^}]*type\s*:\s*['"]character/i.test(t)) return { scope: 'character', reason: 'character 变量' };
    if (/getVariables\s*\(\s*\{[^}]*type\s*:\s*['"]chat/i.test(t) || /chat_metadata/.test(t) || /getvar\s*\(/.test(t) || /\{\{\s*getvar::/i.test(t)) return { scope: 'chat', reason: 'chat 变量 / getvar' };
    return { scope: 'message', reason: '默认（与 MVU 一致）' };
}
/** 稳定序列化：键排序后 JSON.stringify，用来比较两份 stat_data 是否等价 */
export function stableStringify(v) {
    const walk = (x) => {
        if (Array.isArray(x)) return x.map(walk);
        if (x && typeof x === 'object') {
            const out = {};
            for (const k of Object.keys(x).sort()) out[k] = walk(x[k]);
            return out;
        }
        return x;
    };
    try { return JSON.stringify(walk(v)); } catch (_) { return ''; }
}

/**
 * 0.9.4：判断本轮的变量补丁到底有没有生效（纯函数，便于单测）。
 * 真实病灶：「破产后姐姐和美母和我的性交易」第 7 楼里 <JSONPatch> 完全合法（12 个操作），
 * 但该楼自己的 stat_data 快照与上一楼一模一样 → MVU 根本没应用，状态栏自然不更新。
 * @param {{hasBlock:boolean, hasPatch:boolean, ops:number, hasStates:boolean, sameState:boolean}} o
 * @returns {{level:'no-block'|'no-patch'|'unknown'|'not-applied'|'applied'}}
 */
export function patchApplyVerdict(o) {
    const hasBlock = !!(o && o.hasBlock);
    const ops = Number(o && o.ops) || 0;
    if (!hasBlock) return { level: 'no-block' };
    if (!ops) return { level: 'no-patch' };
    if (!o || !o.hasStates) return { level: 'unknown' };
    return { level: o.sameState ? 'not-applied' : 'applied' };
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

/**
 * 0.11.0：按点分/斜杠路径取 stat_data 里的值（'林婉婷.外貌.表情' 与 '/林婉婷/外貌/表情' 等价）。
 * 取不到返回 undefined（不抛错）。
 */
export function valueAtPath(state, path) {
    if (!state || typeof state !== 'object') return undefined;
    const segs = unwrapPathWrapper(path).replace(/^\//, '').split(/[\/.]/).filter((s) => s !== '');
    let node = state;
    for (const s of segs) {
        if (node === null || typeof node !== 'object') return undefined;
        if (!(s in node)) return undefined;
        node = node[s];
    }
    return node;
}

/**
 * 0.11.0：状态级核对 —— 「模型写了这条路径」不等于「变量真的变了」。
 * 用户实测反馈：「面板里 ✅ 一片，状态栏却不更新，检查不出来」。
 * 旧对照表只看回复文本里有没有这条路径（patchCoverage），不看 MVU 存下来的 stat_data 有没有真的变化，
 * 所以补丁合法但没应用时它照样打 ✅。本函数把「文本写了」和「存储值变了」拆成两件事。
 * @param {object} cur  本楼 stat_data（拿不到就传 null）
 * @param {object} prev 上一楼 stat_data
 * @param {Array<{path:string}>} required 本卡要求的字段
 * @param {string[]} covered 本轮文本里写到的路径
 * @param {{applied?:boolean}} [opts] 本楼整体是否真的推进了（stored 与上一楼不同）。
 *   推进了却某字段没变 → 只是「写的值本来就是该值」（same），不是病灶；
 *   整体没推进（补丁没生效）却写了这个字段 → 才是 stuck（⚠️）。
 * @returns {{advanced:string[], stuck:string[], same:string[], absent:string[], noBase:boolean}}
 *   advanced = 值真的变了；stuck = 补丁没生效且写了；same = 写了但值本来就一样；absent = 本轮没写
 */
export function stateDiffFields(cur, prev, required, covered, opts = {}) {
    const out = { advanced: [], stuck: [], same: [], absent: [], pending: [], noBase: !cur || typeof cur !== 'object' };
    // pending = 值的形态就是「还没内容」（未登场/未描述/未触发/未设定）→ 不该打红叉，渲染层标成中性
    const floorApplied = opts.applied === true;
    const cov = new Set(covered || []);
    for (const f of (required || [])) {
        const path = String((f && f.path) || '');
        if (!path) continue;
        const wrote = cov.has(path);
        let cands = [path];
        try { const ex = expandTemplateGroups([path]); if (ex && ex.length) cands = ex; } catch (_) {}
        const defined = cands.some((c) => valueAtPath(cur, c) !== undefined || valueAtPath(prev, c) !== undefined);
        if (out.noBase) { if (!wrote) out.absent.push(path); continue; }
        // 占位形态优先：角色未登场 / 字段未描述时，本轮不写是正常的（不该在面板打红叉）
        if (!wrote && isPlaceholderAt(cur, path)) { out.pending.push(path); continue; }
        if (!defined) { if (!wrote) out.absent.push(path); continue; }
        const changed = cands.some((c) => stableStringify(valueAtPath(cur, c)) !== stableStringify(valueAtPath(prev, c)));
        if (changed) out.advanced.push(path);
        else if (wrote) { if (floorApplied) out.same.push(path); else out.stuck.push(path); }
        else out.absent.push(path);
    }
    return out;
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

// 卡自带的「自动开启角色卡局部正则」这类 helper（StageDog 系脚本），能把本体 disabled 的渲染正则运行时打开
const AUTO_ENABLE_RE = /自动开启.{0,8}正则|开启角色卡局部正则|auto.?enable/i;

/**
 * 0.9.0 新卡哨兵：卡里「被禁用的大块渲染正则」—— 它们关着的时候，状态栏 / 插图 / 面板都不会渲染。
 * 实测有卡就是这么设计的（本体 disabled，靠自带 helper 在运行时打开），所以必须区分出这种情况，否则会误报。
 * @returns {{total:number, images:Array, bars:Array, panels:Array, others:Array, autoEnable:boolean}}
 */
// 名字里的「版本/端/形态」修饰词：判断两条正则是不是同一个东西的变体时先去掉
const VIEW_QUALIFIER_RE = /旧版|新版|备用|备选|适配|适化|移动端|手机端|电脑端|桌面端|简化版|文字版|图片版|在线版|离线版|选一|选择|可选|替换|测试|beta|mobile|desktop|old|new|backup|alt/gi;

/** 名字归一化：去括号与修饰词，只留中英文数字（用于「这条是不是那条的备选」判断） */
export function viewNameCore(name) {
    return String(name || '').replace(/[【】\[\]（）(){}<>「」]/g, ' ').replace(VIEW_QUALIFIER_RE, ' ').replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, ' ').trim();
}

/** 最长公共子串长度（名字都很短，O(n*m) 足够） */
export function longestCommonRun(a, b) {
    const s = String(a || ''), t = String(b || '');
    if (!s || !t) return 0;
    let best = 0;
    const dp = new Array(t.length + 1).fill(0);
    for (let i = 1; i <= s.length; i++) {
        let prev = 0;
        for (let j = 1; j <= t.length; j++) {
            const cur = dp[j];
            dp[j] = s[i - 1] === t[j - 1] ? prev + 1 : 0;
            if (dp[j] > best) best = dp[j];
            prev = cur;
        }
    }
    return best;
}

/** 视图种类：插图 / 状态栏 / 面板 / 其它（启用的、禁用的都用这一套判定） */
function classifyViewKind(s) {
    const rep = typeof s.replaceString === 'string' ? s.replaceString : '';
    const name = String(s.scriptName || '');
    const find = normalizeRegexForTags(s.findRegex);
    if (/<img/i.test(rep) || /插图|图片|image/i.test(rep + ' ' + name) || /NSFW_IMG|SFW_IMG/i.test(find)) return 'image';
    if (VIEW_BAR_RE.test(name) || /StatusPlaceHolder|状态栏/i.test(find)) return 'bar';
    if (VIEW_PANEL_RE.test(rep) || rep.length > 20000) return 'panel';
    return 'other';
}

export function detectDisabledViews(ext) {
    const images = [], bars = [], panels = [], others = [];
    for (const s of (ext?.regex_scripts || [])) {
        if (!s.disabled) continue;
        const rep = typeof s.replaceString === 'string' ? s.replaceString : '';
        if (!rep || rep.trim() === '' || rep.indexOf('<') < 0) continue;
        const hasImg = /<img/i.test(rep);
        // 插图正则本体很短（实测 305 字节），门槛要单独放宽，否则「图片不显示」这类卡漏报
        if (rep.length < (hasImg ? 40 : 400)) continue;   // 含 <img> 的替换内容本身就是渲染器，门槛要低
        const rec = { name: String(s.scriptName || ''), len: rep.length, kind: classifyViewKind(s) };
        if (rec.kind === 'image') images.push(rec);
        else if (rec.kind === 'bar') bars.push(rec);
        else if (rec.kind === 'panel') panels.push(rec);
        else others.push(rec);
    }
    const helpers = (ext?.tavern_helper?.scripts) || [];
    const autoEnable = helpers.some((h) => AUTO_ENABLE_RE.test(String(h.name || '') + ' ' + String(h.content || '')));
    // 0.9.1：判断每条被禁用的正则「是不是已经有同类启用项」—— 旧版/移动端/备用/二选一就不该报警
    const enabled = (ext?.regex_scripts || []).filter((s) => !s.disabled && String(s.replaceString || '').length > 0)
        .map((s) => ({ name: String(s.scriptName || ''), kind: classifyViewKind(s), core: viewNameCore(s.scriptName) }));
    const coveredBy = (rec) => {
        const core = viewNameCore(rec.name);
        for (const e of enabled) {
            if (e.kind === rec.kind) return e.name;                                       // ① 同类已有启用项
            if (!core || !e.core) continue;
            if (e.core.indexOf(core) >= 0 || core.indexOf(e.core) >= 0) return e.name;     // ② 名字互相包含
            if (longestCommonRun(core, e.core) >= 3) return e.name;                        // ③ 名字共 3 字以上
        }
        return '';
    };
    const all = [...images, ...bars, ...panels, ...others];
    let uncovered = 0;
    for (const rec of all) { rec.coveredBy = coveredBy(rec); rec.covered = !!rec.coveredBy; if (!rec.covered) uncovered++; }
    return { total: all.length, uncovered: uncovered, images: images, bars: bars, panels: panels, others: others, autoEnable: autoEnable };
}

/**
 * 0.9.2：本楼「前端块」自检的判定（纯函数，便于单测）。
 * 背景：这类卡用正则把内容换成 ```html 前端块，再由酒馆助手（JS-Slash-Runner）渲染成面板；
 * 酒馆助手自己的判定是 pre 的文本含 html> / <head / <body 之一，没被渲染的块就一直停在代码块状态。
 * @param {{front:number, rendered:number, collapsed:number, fences:number}} o
 *   front=符合前端特征的空 code block 数，rendered=已渲染成面板的数，collapsed=被酒馆助手折叠的按钮数，fences=消息正文里的围栏数
 * @returns {{level:'none'|'ok'|'partial'|'collapse'|'unrendered', front:number, rendered:number, collapsed:number, fences:number}}
 */
export function frontBlockVerdict(o) {
    const front = Number(o && o.front) || 0;
    const rendered = Number(o && o.rendered) || 0;
    const collapsed = Number(o && o.collapsed) || 0;
    const fences = Number(o && o.fences) || 0;
    let level = 'none';
    if (front > 0) {
        if (rendered >= front) level = 'ok';
        else if (rendered > 0) level = 'partial';
        else if (collapsed > 0) level = 'collapse';
        else level = 'unrendered';
    }
    return { level: level, front: front, rendered: rendered, collapsed: collapsed, fences: fences };
}
/**
 * 0.9.3：挑要写进「本轮必更字段」清单的路径 —— 按顶层分组轮询，别永远只列前 N 条。
 * 实测病灶：「破产后姐姐和美母和我的性交易」有 49 条规则，按条目顺序前 12 条全是「系统 / 林婉婷基础」，
 * 互动次数、身体状态、user.累计支出 永远进不了提醒 → 模型每轮都忘更新这些（用户反馈「部分数据不更新」）。
 * @param {Array<{path:string, check?:string}>} fields
 * @param {number} limit 提醒里最多列几条
 */
export function pickReminderFields(fields, limit = 14) {
    const list = (fields || []).filter((f) => f && f.path);
    if (list.length <= limit) return list.slice();
    const groups = new Map();
    for (const f of list) {
        const g = String(f.path).split('.')[0];
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(f);
    }
    const keys = [...groups.keys()];
    const out = [];
    for (let round = 0; out.length < limit; round++) {
        let added = false;
        for (const k of keys) {
            const arr = groups.get(k);
            if (round < arr.length) { out.push(arr[round]); added = true; if (out.length >= limit) break; }
        }
        if (!added) break;
    }
    return out;
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
            const dis = prof.disabledViews || detectDisabledViews(ext);
            // 0.9.0：没抽到规则时的原因（含「有 check 却抽不出」= 我没见过的新方言）
            const ruleStyle = (!required.length && hasData) ? classifyNoRules(entries, ext) : '';
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
                ruleStyle: ruleStyle,
                disabledViews: dis.total,
                disabledUncovered: dis.uncovered || 0,
                autoEnable: dis.autoEnable,
                // 0.9.0 新卡哨兵：需要人注意的两件事 —— 没见过的新方言 / 渲染正则是关着的
                alerts: (function () {
                    const list = [];
                    if (ruleStyle === 'check-unparsed' || ruleStyle === 'other') list.push('new-dialect');
                    // 0.9.1：有同类启用项的算「备选」，只有真缺一块才报警
                    if (dis.total > 0 && !dis.autoEnable) list.push((dis.uncovered || 0) > 0 ? 'disabled-views' : 'disabled-alternative');
                    return list;
                })(),
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
        disabledViews: by((r) => r.disabledViews > 0),
        disabledUncovered: by((r) => (r.disabledUncovered || 0) > 0),
        autoEnableCards: by((r) => r.autoEnable),
        alerts: (function () { const m = {}; for (const r of rows) for (const a of (r.alerts || [])) m[a] = (m[a] || 0) + 1; return m; })(),
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


/* ── 0.16.0：把面板里散落的诊断收成一段「可复制的结论」 ─────────────────
 * 面板本来就有协议/规则数/Zod 摘要/本轮补丁/状态级核对/未声明块这些事实，但用户要自己拼起来才能回答
 * 「这张卡到底为什么不动」。这个纯函数只做归纳：事实 → 一句结论 + 建议动作。不改任何数据。
 */
const DIAG_VERDICT = {
    ok: '守护 + 校验可用',
    'guard-only': '只能守护（本卡没有变量块）',
    'no-rules': '有变量块但抽不到更新规则',
    'read-only': '协议只读（能读不能写回）',
    'format-only': '只有格式标签（仅提醒）',
    'helper-only': '靠酒馆助手脚本渲染',
    plain: '纯正文卡（无需处理）',
    'dyn-bar': '动态状态栏（前端渲染）',
};
/** 生成「本卡诊断」文本：输入全是已知事实，输出给人看/贴给卡作者的一段话 */
export function diagnosisReportText(input) {
    const i = input || {};
    const prof = i.profile || {};
    const proto = i.protocol || {};
    const hints = i.schemaHints || {};
    const counts = (a) => ({
        clamp: (a.clamps || []).length, bound: (a.bounds || []).length, type: (a.types || []).length,
        enums: (a.enums || []).length, default: (a.defaults || []).length, object: (a.objects || []).length,
        int: (a.ints || []).length, catch: (a.catches || []).length, round: (a.rounds || []).length,
    });
    const c = counts(hints);
    const L = [];
    L.push('=== card-compat 本卡诊断 v' + String(i.version || '?') + ' ===');
    L.push('时间：' + new Date(i.at || Date.now()).toLocaleString());
    L.push('角色卡：' + String(i.card || '（未选择）') + '（第 ' + String(i.floor == null ? '-' : i.floor) + ' 楼）');
    L.push('壳/宿主：' + String(i.host || '未知') + ' ｜ 语言：' + String(i.lang || '?'));
    L.push('');
    L.push('【结论】' + (DIAG_VERDICT[i.verdict] || String(i.verdict || '未知')) + (i.ruleStyle ? '（无规则原因：' + i.ruleStyle + '）' : ''));
    L.push('【变量协议】' + String(proto.id || 'none') + (proto.canWriteBack ? '（可写回）' : '（不可写回）'));
    L.push('【能力】锚点 ' + (prof.anchors || []).length + ' ｜ 数据块 ' + (prof.dataTags || []).length + ' ｜ 隐藏目标 ' + (prof.hideTargets || []).length + ' ｜ 其它标签 ' + (prof.rawTags || []).length + ' ｜ 酒馆助手脚本 ' + (prof.helperCount || 0));
    L.push('【规则】可抽路径 ' + String(i.required || 0) + ' 条 ｜ 白名单 ' + String(i.allowed || 0) + ' 条' + (i.ruleStyle ? ' ｜ 未抽到原因 ' + i.ruleStyle : ''));
    L.push('【世界书】条目 ' + String(i.book || 0) + ' ｜ 作用域 ' + String((i.scope && i.scope.scope) || 'message') + '（' + String((i.scope && i.scope.reason) || '') + '）');
    const zod = '夹取' + c.clamp + ' 范围' + c.bound + ' 类型' + c.type + ' 枚举' + c.enums + ' 默认值' + c.default + ' 对象' + c.object + ' 整数' + c.int + ' catch' + c.catch + ' 取整' + c.round;
    L.push('【Zod 结构】' + zod + ' ｜ 无法离线校验 ' + ((hints.unverifiable || []).length));
    if (i.thisFloor) {
        const t = i.thisFloor;
        L.push('【本轮】判定 ' + String(t.verdict || '-') + ' ｜ 数据块 ' + String(t.blocks || 0) + ' ｜ 路径 命中 ' + String(t.covered || 0) + '/' + String(t.total || 0));
    }
    if (i.state) {
        L.push('【状态核对】真的变了 ' + (i.state.advanced || []).length + ' ｜ 写了没变 ' + (i.state.stuck || []).length + ' ｜ 值本来就一样 ' + (i.state.same || []).length + ' ｜ 本轮没写 ' + (i.state.absent || []).length + (i.state.noBase ? '（拿不到 stat_data）' : ''));
    }
    if (i.money && i.money.missingCash) L.push('【资金流】正文出现 ' + i.money.n + '（元）但本楼补丁没有任何现金/欠款字段 → 钱可能没动（模型漏写，可在 MVU 面板补 replace）');
    if (i.guards) L.push('【守护】' + String(i.guards) + ' ｜ 未声明块删除 ' + String(i.removed || 0) + ' ｜ YAML 修复 ' + String(i.yamlFixes || 0));
    if (i.floors) L.push('【变量兜底】已补应用 ' + String(i.floors.written || 0) + ' 层 ｜ 跳过 ' + String(i.floors.skipped || 0) + ' 层 ｜ 收支保护命中 ' + String(i.floors.guard || 0) + ' ｜ Zod 拦下 ' + String(i.floors.schema || 0));
    const recent = i.recent || [];
    if (recent.length) {
        L.push('');
        L.push('【最近动作】');
        for (const r of recent.slice(-8)) L.push('  - ' + String(r));
    }
    L.push('');
    L.push('【它现在在做什么】');
    for (const a of diagnosisActions(i)) L.push('  - ' + a);
    return L.join(String.fromCharCode(10));
}
/** 事实 → 建议动作（顺序 = 先做最可能见效的） */
export function diagnosisActions(input) {
    const i = input || {};
    const prof = i.profile || {};
    const hints = i.schemaHints || {};
    const out = [];
    const logText = (i.recent || []).join(' ');
    if (i.verdict === 'plain') return ['纯正文卡：不需要变量守护，面板里可关掉提醒'];
    if (!(prof.anchors || []).length) out.push('本卡没有锚点：状态栏只能靠卡自己的前端渲染，本扩展不会补占位符');
    if ((i.disabledViews || 0) > 0 && (i.disabledUncovered || 0) > 0) out.push('有被禁用的渲染正则且没有同类启用项（常见原因：导入时被批量禁用）→ 去酒馆助手/正则面板启用');
    if (i.verdict === 'no-rules') out.push('有变量块但抽不到规则：规则可能写在世界书的散文里或 schema 脚本里 → 面板「兼容性体检」可看原因分类');
    if (hints.unverifiable && hints.unverifiable.length) out.push('本卡有 ' + hints.unverifiable.length + ' 处无法离线校验的约束（transform/refine）：只应用可静态校验的部分，剩下的靠模型自己写对');
    if ((i.schemaFails || 0) > 0) out.push('有写入被 Zod 结构拦下 ' + i.schemaFails + ' 次：看日志 var-schema 的具体路径，多半是模型写了类型不符的值');
    if (logText.indexOf('yaml-strict-fail') >= 0 || logText.indexOf('block-yaml-issue') >= 0) out.push('结构块 YAML 解析失败：数据可能显示不全，用面板「严格校验当前楼层」定位那一行');
    const st = i.state || {};
    if (st.stuck && st.stuck.length) out.push('有 ' + st.stuck.length + ' 个字段「补丁写了但变量没变」：可能是 MVU 没应用 → 面板点「补应用变量」，或去 MVU 面板「重演楼层」');
    if (st.noBase) out.push('拿不到 stat_data：MVU 可能没在运行 / 未初始化 → 先确认 MVU 已加载');
    if ((i.guards || 0) > 0 && !out.length) out.push('本轮正常：守护动作 ' + i.guards + ' 次，没有发现异常');
    if (!out.length) out.push('没有发现明显问题');
    return out;
}

/* ── 0.16.1：占位值识别 ──────────────────────────────────────────────
 * 实测（用户那张卡）：规则用 `${林婉婷|陈慧兰}` 模板组同时管两个角色，于是对照表里必然出现
 * 「陈慧兰.位置 / 外貌.发型 / 心情 …」这些字段 —— 但卡的规则写着「陈慧兰在剧情天数<7 时保持未登场」，
 * 这些字段本来就不该更新。面板却对它们打红叉 ❌，看起来像报错，其实完全正常。
 * 这里只做一件事：把「值的形态就表示还没内容」的路径标出来，让渲染层用中性符号代替红叉。
 */
/** 只认「明确表示还没内容」的形态；特意**不含 '无'** —— 「当前在做什么: 无」是合法值，误判会掩盖真问题 */
const PLACEHOLDER_VALUES = ['未登场', '未描述', '未触发', '未设定', '待登场', '待描述'];
export function isPlaceholderValue(v) {
    if (v === undefined || v === null) return false;
    const s = String(v).trim();
    return PLACEHOLDER_VALUES.indexOf(s) >= 0;
}
/** 身体状态这类对象里，只有「状态」子键取到占位值才算占位 */
const OBJECT_PLACEHOLDER_KEYS = new Set(['状态', 'status']);
/** 判断某条路径当前值是否属于「还没内容」的占位形态；带模板组会逐个候选试 */
export function isPlaceholderAt(state, path) {
    if (!state || typeof state !== 'object') return false;
    let cands = [String(path || '')];
    try { const ex = expandTemplateGroups(cands); if (ex && ex.length) cands = ex; } catch (_) {}
    for (const c of cands) {
        const v = valueAtPath(state, c);
        if (v === undefined) continue;
        if (isPlaceholderValue(v)) return true;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            for (const k of Object.keys(v)) if (OBJECT_PLACEHOLDER_KEYS.has(k) && isPlaceholderValue(v[k])) return true;
        }
    }
    return false;
}

/* ── 0.16.2：连续硬失败统计（纯函数，便于夹具） ─────────────────────
 * data-missing / varfix-invalid / yaml-strict-fail / undeclared-block-stripped 原先只进面板日志，
 * 用户看不到 →「状态栏不动却什么提示都没有」。这里只算「同类连续几次」，弹不弹由调用方决定。
 */
export const FAIL_CATS = ['data', 'varfix', 'yaml', 'undeclared'];
export function emptyFailStreak() { const o = {}; for (const k of FAIL_CATS) o[k] = 0; return o; }
/**
 * 记录一次硬失败。
 * @param {object} st 计数对象（会被就地修改）
 * @param {string} cat 类别（不在 FAIL_CATS 里则忽略）
 * @param {number} now 时间戳
 * @param {{lastAt?:number, cooldownMs?:number, threshold?:number}} [opts]
 * @returns {{streak:number, alert:boolean, reason:string}}
 */
export function noteFailure(st, cat, now, opts = {}) {
    const out = { streak: 0, alert: false, reason: '' };
    if (!st || FAIL_CATS.indexOf(cat) < 0) { out.reason = 'unknown-cat'; return out; }
    const threshold = Number(opts.threshold) > 0 ? Number(opts.threshold) : 3;
    const cooldown = Number(opts.cooldownMs) > 0 ? Number(opts.cooldownMs) : 10 * 60 * 1000;
    // 同类连续：只加自己，其它类别清零（换一种失败说明前一种已经过去）
    for (const k of FAIL_CATS) if (k !== cat) st[k] = 0;
    st[cat] = (Number(st[cat]) || 0) + 1;
    out.streak = st[cat];
    if (out.streak < threshold) { out.reason = 'below-threshold'; return out; }
    if ((Number(now) || 0) - (Number(opts.lastAt) || 0) <= cooldown) { out.reason = 'cooling-down'; return out; }
    out.alert = true;
    out.reason = 'alerted';
    return out;
}

/* ── 0.20.0：资金流体检 ───────────────────────────────────────────
 * 起因（用户实测）：给了林婉婷 3000 现金，状态栏里她的「现金」没变。
 * 查了原始数据：模型这一楼只写了 `/user/累计支出_林婉婷 +3000`，**根本没写任何 /…/现金** 的 op ——
 * 所以不是写回失败，是模型漏写。这类漏写以前只能靠人肉逐行看 JSONPatch 才发现。
 * 这里做的是「只在真有资金动作时提醒」：金额 ≥ 门槛 且 补丁里没有任何资金类路径 → 报出来并给出可复制的补丁。
 */
const MONEY_CASH_RE = /(现金|欠款|钱包|资产|资金|余额|存款)/;
const MONEY_FLOW_RE = /(支出|收入|花费|消费|付款|支付)/;
/**
 * 从文本里抠金额。两手准备：
 * ① ASCII 数字 + 单位（`3000现金` / `1,200 元`）
 * ② 汉字数字 + 千/百/万/亿（`三千块` / `五百元` / `两万`）—— 实测模型常在正文里写汉字金额。
 * 明确不做的事：不猜「一些钱」「很多钱」这类模糊表达（宁缺勿滥，避免噪音）。
 */
export function moneyAmountOf(text) {
    const s = String(text == null ? '' : text);
    const unit = '(?:元|块钱|块|现金|人民币|RMB)';
    const ascii = s.match(new RegExp('(\\d[\\d,]{2,})\\s*' + unit));
    if (ascii) {
        const n = Number(ascii[1].replace(/,/g, ''));
        if (Number.isFinite(n)) return n;
    }
    const CN = { '零': 0, '一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    const SCALE = { '十': 10, '百': 100, '千': 1000, '万': 10000, '亿': 100000000 };
    // 两种形态：① 万/亿 当量词（`两万块` 里的「万」本身就是量级）② 单位或明确的收付语境
    const cn = s.match(/([零一两二三四五六七八九][零一两二三四五六七八九十百千万亿]*[万亿])(?:块钱|块|元|现金|人民币|RMB|钱|款)/)
        || s.match(/([零一两二三四五六七八九十百千万亿]{1,8})\s*(?:元|块钱|块|现金|人民币|RMB|钱|款|费用|金额|给|付|花|收|拿|递|塞|赏|借|还)/);
    if (!cn) return null;
    let total = 0, section = 0, num = 0, seen = false;
    for (const ch of cn[1]) {
        if (CN[ch] !== undefined) { num = CN[ch]; seen = true; continue; }
        const sc = SCALE[ch];
        if (sc === undefined) continue;
        seen = true;
        if (sc >= 10000) { total = (total + (section + (num || 1)) * sc); section = 0; } else section += (num || 1) * sc;
        num = 0;
    }
    if (!seen) return null;
    const n = total + section + num;
    return n >= 1 ? n : null;
}
/** 补丁里出现过哪些「资金类路径」（归一成 /a/b 形式） */
export function moneyPathsIn(patchText) {
    const out = [];
    const s = String(patchText || '');
    const re = /"path"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(s))) {
        const p = String(m[1]).trim();
        if (!p) continue;
        if (MONEY_CASH_RE.test(p) || MONEY_FLOW_RE.test(p)) {
            const norm = p.charAt(0) === '/' ? p : ('/' + p);
            if (out.indexOf(norm) < 0) out.push(norm);
        }
    }
    return out;
}
/**
 * 资金流体检：这一楼有没有「提到钱、补丁却没落到资金字段」的迹象。
 * @returns {{n:number, amount:number, hasCash:boolean, flow:boolean, missingCash:boolean, hint:string} | null}
 */
export function moneyFlowHint(text, patchText, opts = {}) {
    const amount = moneyAmountOf(text);
    const min = Number(opts.minAmount) > 0 ? Number(opts.minAmount) : 500;
    if (!amount || amount < min) return null;
    const paths = moneyPathsIn(patchText);
    const hasCash = paths.some((p) => MONEY_CASH_RE.test(p));
    const flow = paths.some((p) => MONEY_FLOW_RE.test(p));
    // 只在「有资金动作但没动现金/欠款」时提醒；纯支出记账属于设计（卡里累计支出是独立字段）
    const missingCash = !hasCash;
    return {
        n: amount,
        amount: amount,
        hasCash: hasCash,
        flow: flow,
        missingCash: missingCash,
        hint: missingCash ? (flow ? 'flow-only' : 'no-money-path') : 'ok',
    };
}

/* ── 0.20.0：资金账目对账 ─────────────────────────────────────────
 * 用户实测第二例：「统计数据里面的金额也不对」—— 逐楼核对后发现：
 *   楼 #3 的存储里「user.累计支出_林婉婷」从 0 变成 2500，但那一楼的 <UpdateVariable> 里**只有 Analysis、没有 JSONPatch**；
 *   楼 #5 写了 现金-2500 / 累计支出+2500，存储却没动（透支保护把整楼 patch 跳掉了）。
 * 所以「模型想写的钱」和「账本实际记的钱」可能对不上。这里只做**对账**：给出每层模型打算写的金额与账本实际变化，不一致就报出来。
 * 不做的事：不替卡改账（钱怎么走是卡的设计）。
 */
/** 从一层的 ops 里取某条路径上的数值变化（delta 用 value，replace 需要 prev 才能算） */
function amountDeltaOn(op, prevState) {
    const p = String((op && op.path) || '');
    if (!p) return null;
    const kind = String(op.op || '').toLowerCase();
    if (kind === 'delta') return Number(op.value) || (op.value === 0 ? 0 : null);
    if (kind === 'replace') {
        if (!prevState) return null;
        const segs = unwrapPathWrapper(p).replace(/^\//, '').split('/').filter(Boolean);
        let cur = prevState;
        for (const s of segs) { if (cur == null || typeof cur !== 'object') return null; cur = cur[s]; }
        if (typeof cur !== 'number' || typeof op.value !== 'number') return null;
        return op.value - cur;
    }
    return null;
}
/**
 * 对账：把「模型打算写的金额」和「账本实际变化」逐层比一遍。
 * @param {Array<{floor:number, ops:Array, stored:number|null, prevStored:number|null}>} rows
 * @returns {{checked:number, mismatches:Array<{floor:number, planned:number, actual:number|null, stored:number|null}>}}
 */
export function moneyLedgerDrift(rows) {
    const mismatches = [];
    let checked = 0;
    for (const r of (rows || [])) {
        if (!r || r.stored == null) continue;
        const planned = (r.ops || []).reduce((n, op) => { const d = amountDeltaOn(op, r.prevState || null); return d == null ? n : n + d; }, 0);
        if (!planned) continue;
        checked++;
        const actual = (r.prevStored == null) ? null : (r.stored - r.prevStored);
        if (actual == null) continue;
        if (actual !== planned) mismatches.push({ floor: r.floor, planned: planned, actual: actual, stored: r.stored });
    }
    return { checked: checked, mismatches: mismatches };
}

/* ── 0.21.0：资金纠正（不只诊断） ───────────────────────────────────
 * 用户的第 3 问：「咱们的插件不能纠正吗？只能诊断？」
 * 能纠正，而且卡里本来就有现成的授权 —— 「累计支出_X」正是卡设计的「user 付了多少钱」账本；
 * 「该给谁加多少钱」就是「谁的累计支出增加了多少」。所以规则明确的情况下可以**算出**该补什么，
 * 不需要猜方向。剩下的情况（无累计支出锚点、金额<门槛、路径已被写）一律**只诊断不代写**。
 */
/** 全部 stat_data 里的数值路径（用于找「钱相关的候选字段」） */
function numericPathsOf(state, limit) {
    const out = [];
    const walk = (node, prefix) => {
        if (out.length > (limit || 400)) return;
        if (!node || typeof node !== 'object') return;
        for (const k of Object.keys(node)) {
            const v = node[k];
            const p = prefix ? (prefix + '/' + k) : k;
            if (typeof v === 'number') out.push(p);
            else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p);
        }
    };
    walk(state, '');
    return out;
}
/**
 * 生成「资金纠正」建议：只在规则明确时给出可直接应用的补丁。
 * 规则（与那张卡的写法一致）：`/user/累计支出_<角色>` 的增量 = 该角色这一轮收到的钱。
 * @param {{amount:number, text:string, patchText:string, state:object, minAmount?:number}} input
 * @returns {{ok:boolean, reason:string, actions:Array<{label:string, path:string, delta:number}>}}
 */
export function moneyCorrection(input) {
    const i = input || {};
    const amount = Number(i.amount) || 0;
    const min = Number(i.minAmount) > 0 ? Number(i.minAmount) : 500;
    if (amount < min) return { ok: false, reason: 'amount-too-small', actions: [] };
    const cap = Number(i.maxDelta) > 0 ? Number(i.maxDelta) : 100000;   // 单次修正上限：防解析错误导致写入离谱金额
    if (amount > cap) return { ok: false, reason: 'delta-too-large', actions: [] };
    const paths = moneyPathsIn(i.patchText || '');
    if (paths.some((p) => MONEY_CASH_RE.test(p))) return { ok: false, reason: 'cash-path-present', actions: [] };
    const state = i.state;
    if (!state || typeof state !== 'object') return { ok: false, reason: 'no-state', actions: [] };
    // 看这一楼的补丁把「谁的累计支出」加了钱 → 那个人就是收钱的人
    // 0.21.2 修复：以前用一条紧凑正则去匹配补丁文本，而真实补丁是**带空格的 pretty JSON**（`"op": "delta"`），
    // 于是永远匹配不到 → 面板只出诊断、不出按钮（用户实测「功能没生效」）。现在优先用**已解析的 ops**。
    const spendDeltas = [];
    const pushFromOps = (list) => {
        for (const op of (list || [])) {
            if (!op) continue;
            if (String(op.op || '').toLowerCase() !== 'delta') continue;
            const sp = String(op.path || '');
            const mm = sp.match(/累计支出[_\.\/]?([^\/"\s]+)/);
            if (!mm) continue;
            const v = Number(op.value);
            if (Number.isFinite(v) && v > 0) spendDeltas.push({ who: mm[1], delta: v });
        }
    };
    pushFromOps(i.ops);
    if (!spendDeltas.length && i.patchText) {
        // 兜底：调用方只给了文本时，才退回文本解析（容忍空格）
        const re2 = /"op"\s*:\s*"(\w+)"\s*,\s*"path"\s*:\s*"([^"]+)"\s*,\s*"value"\s*:\s*(-?\d+(?:\.\d+)?)/g;
        let m2;
        while ((m2 = re2.exec(String(i.patchText)))) {
            if (String(m2[1]).toLowerCase() !== 'delta') continue;
            const sp2 = String(m2[2]);
            const mm2 = sp2.match(/累计支出[_\.\/]?([^\/"\s]+)/);
            if (!mm2) continue;
            const v2 = Number(m2[3]);
            if (Number.isFinite(v2) && v2 > 0) spendDeltas.push({ who: mm2[1], delta: v2 });
        }
    }
    if (!spendDeltas.length) return { ok: false, reason: 'no-spend-anchor', actions: [] };   // 没有支出锚点 → 推不出「该给谁加钱」
    const known = numericPathsOf(state, 400);
    const actions = [];
    for (const sd of spendDeltas) {
        const whoPrefix = sd.who + '/';
        const cashPath = known.find((p) => p.indexOf(whoPrefix) === 0 && /(现金|钱包|余额|存款)/.test(p) && !/(现金|钱包|余额|存款)[\/]/.test(p.slice(whoPrefix.length)));
        if (!cashPath) continue;
        actions.push({ label: sd.who, path: '/' + cashPath, delta: sd.delta, who: sd.who });
    }
    if (!actions.length) return { ok: false, reason: 'no-cash-path', actions: [] };
    return { ok: true, reason: 'suggested', actions: actions };
}
