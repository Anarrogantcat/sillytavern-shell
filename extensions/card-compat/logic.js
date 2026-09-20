// logic.js — 纯函数层（不依赖 ST/DOM，可被 Node 单测）
// 职责：从角色卡的正则脚本推导「锚点标签族 / 数据块标签族 / 隐藏目标」，并对消息文本做守护

const TAG_RE = /<\/?([A-Za-z][A-Za-z0-9_!-]*)\s*\/?>/g;
const HIDE_RE = /隐藏|删除|去除|hide|remove|strip/i;
const DATA_RE = /UpdateVariable|变量/i;

/** 宽松标签抽取：允许中文标签名（卡的格式标签常见形如 <正文>、<女主A_名字>），用于「本卡声明了哪些标签」 */
export function broadTagsOf(text) {
    const out = new Set();
    const re = /<(\/?)([^\s<>/]{1,40})\s*(\/?)>/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
        const name = m[2];
        // 允许 ~ ! - 等杂字符（实测模型会写出 <konatan_planning~> 这种），只要不是纯符号即可
        if (/^[A-Za-z\u4e00-\u9fa5][^\s<>\/]{0,39}$/.test(name)) out.add(name);
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
    for (const name of names) {
        if (declared.has(name) || keep.has(name) || keep.has(name.toLowerCase())) continue;
        // 转义正则元字符：只保留字母/数字/下划线/汉字，其余一律加反斜杠（用 fromCharCode 免得层层转义写错）
        const esc = String(name).split('').map((ch) => { const c = ch.codePointAt(0); return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 0x2e80 ? ch : String.fromCharCode(92) + ch; }).join('');
        const pairRe = new RegExp('<' + esc + '(?:\\s[^>]*)?>[\\s\\S]*?</' + esc + '\\s*>', 'g');
        const hits = out.match(pairRe);
        if (hits && hits.length) {
            for (const h of hits) removed.push({ tag: name, chars: h.length });
            out = out.replace(pairRe, '');
            continue;
        }
        if (new RegExp('<' + esc + '(?:\\s[^>]*)?>').test(out)) unclosed.push(name);
    }
    return { text: out, removed, unclosed };
}

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
    const anchors = new Set();      // 有「渲染脚本」（替换内容非空）盯着的标签 → 可以补
    const dataTags = new Set();
    const strippers = new Set();    // 只有「剥除脚本」（替换内容为空）盯着的标签 → 不补
    const forms = {};               // tag -> 'self'（自闭合 <Tag/>）| 'pair'（成对 <Tag>…</Tag>）
    for (const s of (ext?.regex_scripts || [])) {
        if (s.disabled) continue;
        const named = HIDE_RE.test(String(s.scriptName || ''));
        // 有明确替换内容 → 渲染脚本；明确空串 → 剥除脚本；未提供 → 退回按名字判断
        const isStripper = typeof s.replaceString === 'string' ? s.replaceString.trim() === '' : named;
        const rx = String(s.findRegex || '').split('\\/').join('/');
        for (const tag of tagsOf(rx)) {
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
            ...broadTagsOf((ext?.regex_scripts || []).map((s) => String(s.findRegex || '') + ' ' + String(s.replaceString || '')).join('\n')),
            ...broadTagsOf(helperText),
        ])],
        // 只有剥除脚本盯着、没有任何渲染脚本的标签 → 不补（补了反而多出裸标签）
        injectableAnchors: [...anchors],
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
 * 结构块 YAML「预检 + 修复」（不依赖 js-yaml，纯行级规则）——覆盖实测会打挂卡前端解析的两类写法：
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

/** 修复畸形的结束标签：</Tag（缺 >）→ </Tag>，仅对给定标签族生效 */
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
 * 从角色卡世界书条目里抽出「本轮必须更新的字段清单」
 * 解析 [mvu_update]变量更新规则 这类条的缩进结构：组(缩进2) / 字段(缩进4) + check 条件
 * @returns {Array<{path:string, check:string}>}
 */
export function extractRequiredFields(entries, limit = 10) {
    const text = (entries || []).map(e => String(e?.content || "")).join("\n");
    if (!text) return [];
    const lines = text.split("\n");
    const out = [];
    let group = "", field = null, inCheck = false;
    const push = () => {
        if (field && field.check) out.push({ path: group + "." + field.name, check: field.check.trim() });
        field = null; inCheck = false;
    };
    for (const rawLine of lines) {
        const line = String(rawLine).replace(/\t/g, "    ").replace(/\s+$/, "");
        const body = line.trim();
        if (!body || body.indexOf("---") === 0 || body.indexOf("#") === 0) continue;
        const indent = line.length - line.replace(/^\s+/, "").length;
        if (indent <= 2) {
            if (indent === 2) { push(); group = body.replace(/:.*$/, "").trim(); }
            continue;
        }
        if (indent === 4) {
            push();
            field = { name: body.replace(/:.*$/, "").trim(), check: "" };
            continue;
        }
        if (!field) continue;
        if (/^check\s*:/i.test(body)) { inCheck = true; continue; }
        if (inCheck) {
            const item = body.replace(/^[-*]\s*/, "").trim();
            if (item) field.check += (field.check ? " / " : "") + item;
        }
    }
    push();
    // 展开全部 ${A|B} 模板组（可能同时出现在组名与字段名里），最多 8 轮
    let pool = out.slice();
    for (let round = 0; round < 8; round++) {
        let changed = false;
        const next = [];
        for (const f of pool) {
            const mm = f.path.match(/\$\{([^}]+)\}/);
            if (mm) {
                changed = true;
                for (const alt of mm[1].split(/[|｜]/)) next.push({ path: f.path.replace(mm[0], alt.trim()), check: f.check });
            } else next.push(f);
        }
        pool = next;
        if (!changed) break;
    }
    return pool.slice(0, limit);
}
/**
 * 统计模型写出的 <UpdateVariable> 块覆盖了哪些必更字段
 * @returns {{total:number, covered:string[], missing:string[]}}
 */
export function patchCoverage(text, required) {
    const t = String(text || "");
    const block = (t.match(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/) || [t])[0];
    const norm = p => String(p || "").replace(/\./g, "/").replace(/^\/*/, "/");
    const covered = [], missing = [];
    for (const f of (required || [])) {
        const want = norm(f.path);
        if (block.indexOf(want) >= 0) covered.push(f.path); else missing.push(f.path);
    }
    return { total: (required || []).length, covered, missing };
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
