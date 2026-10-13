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

export const VERSION = '0.5.7';
export const EXT_ID = 'cine-dialogue';

/** 五种层 */
export const LAYERS = ['台词', '动作', '感官', '心理', '旁白'];

/** 层 → CSS 类（cd- 前缀，符合 AGENTS §0.3.2） */export const LAYER_CLS = {
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

    /* ---- L3 提示词层 ---- */
    /** 自动把格式说明注入提示词。
     *  ★ 默认 **false**：你已经在用专属预设 `Izumi 0828.tailfree + 分镜`，那份里已有同样的说明；
     *    两边同时开会**重复占提示词**。只有换回原版预设时才需要打开。 */
    injectPrompt: false,
    /** 注入深度（越深越靠近当前对话；4 是常用值） */
    promptDepth: 4,
    /** 注入位置：0=系统提示后（in-chat 用 1） */
    promptPosition: 0,

    /* ---- L5 数据层 ---- */
    /** 逐角色指定颜色：{ 名字: '#rrggbb' }；没指定的按出现顺序分配 */
    charColors: {},
    /** 逐卡配置覆盖：{ 角色卡文件名: { …覆盖项 } }（由代码维护，不在面板里手改） */
    perCard: {},
    /** 自定义层：[{ name:'系统', mark:'dashed', italic:false }] */
    customLayers: [],
    /** 批量渲染只处理最近 N 楼；更早的不做 DOM 降级渲染（<=0 = 不限） */
    maxRenderFloors: 80,

    /* ---- L2 交互层 ---- */
    /** 只看某角色（其余凸显变淡）；空 = 不过滤 */
    onlyChar: '',
    /** 行内高亮搜索词；空 = 不搜索 */
    highlight: '',
    /** 双击行复制该行文本 */
    copyOnClick: true,
};

/**
 * 格式说明（唯一权威文本）
 *
 * ★ 为什么不写在提示词里让用户手抄：离开这段说明模型就不会输出我们的行格式，插件就废了。
 *   因此它是**插件自带**的，可用 `injectPrompt` 自动注入；
 *   专属预设 `Izumi 0828.tailfree + 分镜` 里那段**就是这份文本的副本**，两边保持一致。
 */
export const FORMAT_SPEC = [
    '【正文行格式 · 必须严格遵守】',
    '正文每一个自然段都是一行「名字·层 内容」，四层轮换推进：',
    '  名字·台词 「说的话」        ← 台词要短，一般不超过 20 字',
    '  名字·动作 我做的具体动作     ← 200–400 字，写细节、写过程',
    '  名字·感官 我身体的感受       ← 200–400 字，写触感/温度/气味/声音',
    '  名字·心理 我心里的想法       ← 200–400 字，写犹豫/欲望/算计',
    '旁白单独一行：旁白·内容（没有名字字段，用来说明画面/时间/环境）。',
    '',
    '硬规则：',
    '1. 层名后**必须有一个空格**，写漏了会被判为格式错误并标红。',
    '2. 层名只能是 台词 / 动作 / 感官 / 心理 / 旁白 这五个，不得自创。',
    '3. 正文里**不得出现**「名字·层」以外的标记、标签、小标题、列表符号。',
    '4. 台词/动作/感官/心理 一律**第一人称「我」** —— 这里的「我」就是这一行的角色本人。',
    '5. 一行里的「我」＝该行的名字。提到别人时：**首次出现用真名**，之后如果这一行只涉及另一个人才可以用他/她。',
    '6. 称呼（妈 / 婉婷姐 / 老师）可以出现在句子里，但**不得**当作名字列的标签。',
    '7. 只有 动作/感官/心理 三层需要写长；台词与旁白要短。',
    '8. 不要输出任何解释、前言、后记、分隔线。',
].join('\n');

/**
 * 专属正则（4 条，**纯数据**）—— 用 `TavernHelper.updateTavernRegexesWith` 注册
 *
 * 形状按酒馆助手归一化后的 TavernRegex（不是 ST 存储形状）。
 * 全部只改 `destination.display`（不碰提示词），`max_depth: 3`（只作用最近 3 楼）。
 *
 * R1/R4 默认 **关**（可选）；R2/R3 默认 **开** —— 但注意：
 *   **渲染漏斗钩子路径本来就能同时认 `[FRONTEND]` 与 `<htmlcontent>`**（见 splitSections），
 *   所以 R2/R3 只在「没打核内补丁、走 DOM 后处理」那条降级路径上才必需。
 */
export const REGEX_DEFS = [
    {
        id: 'cd-r1-strip-content',
        script_name: '【分镜】R1 去掉 <content> 包裹',
        enabled: false,
        find_regex: '<\\/?content>\\n?',
        replace_string: '',
        flags: 'g',
        destination: { display: true, prompt: false },
        run_on_edit: true,
        min_depth: null,
        max_depth: 3,
        note: '可选。预设用 <content> 包正文时去掉它，避免被当成普通文本显示。',
    },
    {
        id: 'cd-r2-frontend',
        script_name: '【分镜】R2 前端区包成 [FRONTEND]',
        enabled: true,
        find_regex: '(<htmlcontent>[\\s\\S]*?<\\/htmlcontent>)',
        replace_string: '\n[FRONTEND]\n$1\n[/FRONTEND]\n',
        flags: 'g',
        destination: { display: true, prompt: false },
        run_on_edit: true,
        min_depth: null,
        max_depth: 3,
        note: '必需（DOM 降级路径）。让插件认出前端区并整段跳过，一个字节不碰。',
    },
    {
        id: 'cd-r3-options',
        script_name: '【分镜】R3 选项区包成 [OPTIONS]',
        enabled: true,
        find_regex: '(<options>[\\s\\S]*?<\\/options>)',
        replace_string: '\n[OPTIONS]\n$1\n[/OPTIONS]\n',
        flags: 'g',
        destination: { display: true, prompt: false },
        run_on_edit: true,
        min_depth: null,
        max_depth: 3,
        note: '必需（DOM 降级路径）。让插件把选项区渲染成按钮。',
    },
    {
        id: 'cd-r4-collapse-blank',
        script_name: '【分镜】R4 压缩连续空行',
        enabled: false,
        find_regex: '\\n{3,}',
        replace_string: '\n\n',
        flags: 'g',
        destination: { display: true, prompt: false },
        run_on_edit: true,
        min_depth: null,
        max_depth: 3,
        note: '可选。模型偶尔多吐空行，会把段落间距撑开。',
    },
];

/**
 * 设置面板的字段表（**纯数据**，由 index.js 拿去生成抽屉）
 *
 * 为什么要放在这里：面板 HTML 在 index.js（碰 DOM），但字段定义放纯函数层，
 * 夹具就能断言「每个 key 都真的存在于 DEFAULT_CONFIG」—— 挡住拼错 key 这类静默失效。
 */
export const PANEL_FIELDS = [
    { key: 'enabled', kind: 'bool', label: '启用分镜渲染', note: '关掉后一个字节都不改消息' },
    { key: 'transformUserMessages', kind: 'bool', label: '也渲染用户消息', note: '默认关：你打的是大白话，通常不是分镜格式' },
    { key: 'indentOnlyWrapped', kind: 'bool', label: '首行缩进只给换行的段落', note: '关掉 = 除台词外全部缩进' },
    { key: 'markErrors', kind: 'bool', label: '格式错的行标红', note: '关掉 = 不显示（不推荐，会静默吞掉格式错误）' },
    { key: 'nameColMode', kind: 'select', label: '名字列宽', note: 'auto = 按整条消息最长名字',
      options: [['auto', '自动（推荐）'], ['left', '自动（同左）'], ['fixed', '固定像素']] },
    { key: 'nameColWidth', kind: 'number', label: '固定宽度', unit: 'px', min: 40, max: 400, step: 4, when: 'nameColMode=fixed' },
    { key: 'rowGap', kind: 'number', label: '行间距', unit: 'em', min: 0, max: 3, step: 0.1 },
    { key: 'leadIndent', kind: 'number', label: '首行缩进', unit: 'em', min: 0, max: 4, step: 0.5 },

    /* ---- L3 提示词层 ---- */
    { key: 'injectPrompt', kind: 'bool', label: '自动注入格式说明',
      note: '默认关：专属预设里已有同样说明，两边同时开会重复占提示词' },
    { key: 'promptDepth', kind: 'number', label: '注入深度', unit: '层', min: 0, max: 20, step: 1 },
    { key: 'promptPosition', kind: 'select', label: '注入位置',
      options: [['0', '系统提示内'], ['1', '对话内（更靠后）']] },

    /* ---- L5 数据层 ---- */
    { key: 'maxRenderFloors', kind: 'number', label: '批量渲染上限', unit: '楼',
      min: 0, max: 2000, step: 20, note: '0 = 不限；只影响 DOM 降级路径，装了核内钩子时由 ST 自己按窗口渲染' },

    /* ---- L2 交互层 ---- */
    { key: 'copyOnClick', kind: 'bool', label: '双击复制该行', note: '关掉 = 双击不复制（Alt+↑/↓ 跳场景不受影响）' },
];

/**
 * L4 斜杠命令（**纯数据**：名字 + 子命令 + 说明；注册与执行在 index.js）
 *
 * 形状照已装扩展 RUBY 的范例：ST 通过 `getContext()` 暴露
 * `SlashCommandParser` / `SlashCommand` / `SlashCommandArgument` / `ARGUMENT_TYPE`，
 * 用 `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))` 注册。
 * 用**单个命令 + 子命令**而不是 4 个命令：斜杠命令面板更干净，也更好记。
 */
export const SLASH_COMMAND = {
    name: 'cine',
    aliases: ['cd', 'storyboard'],
    returns: '状态文本',
    helpString: '分镜对话控制：<code>/cine refresh</code> 立即重渲染 · '
        + '<code>/cine stats</code> 心跳与适配探测 · <code>/cine config</code> 当前配置 · '
        + '<code>/cine regex</code> 安装【分镜】专属正则',
    /** 子命令（第一个无名参数） */
    subcommands: [
        { name: 'refresh', description: '立即重渲染全部楼层的分镜' },
        { name: 'stats', description: '打印心跳：版本 / 核内钩子接线 / 渲染计数 / 各适配探测' },
        { name: 'config', description: '打印当前配置' },
        { name: 'regex', description: '安装或更新【分镜】专属正则（4 条）' },
    ],
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

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 层名分支：内置四层 + 自定义层。
 *  ★ 不能用 ['台词','动作','感官','心理'].join('|') + '|' + extra.join('|') ——
 *    自定义层为空时会在尾部留下一个 `|`，产生**空层名分支**，
 *    于是 `林野· 内容`（漏了层名）会被当成**合法行**而不是格式错误。 */
function layerAlternation(layers) {
    const extra = (layers || LAYERS).filter(l => LAYERS.indexOf(l) < 0);
    const all = ['台词', '动作', '感官', '心理'].concat(extra);
    return all.map(escRe).join('|');
}

/** 内置层 + 配置里的自定义层（去重、保序） */
export function allLayers(config = {}) {
    const custom = Array.isArray(config.customLayers) ? config.customLayers : [];
    const names = custom.map(l => (typeof l === 'string' ? l : (l && l.name))).filter(Boolean);
    return LAYERS.concat(names.filter(n => LAYERS.indexOf(n) < 0));
}

/* 动态层名正则的缓存：不给每一行都 new 一个 RegExp。
   ★ key 初值必须是 null，不能是 '' —— 否则会和「没有自定义层」时的真实 key（空串）撞上，
     正则**永远不会被构建**（re 停在 null），松散匹配全部失效。
     这是夹具抓到的真 bug：结果「层名后漏空格」这种最常见的格式错误根本标不出来。 */
let _layerRe = { key: null, re: null };
let _looseRe = { key: null, re: null };

/** 取「认哪些层」的行正则；没有自定义层时直接返回内置 RE_ROW */
export function rowRegexFor(layers) {
    const extra = (layers || LAYERS).filter(l => LAYERS.indexOf(l) < 0);
    if (!extra.length) return RE_ROW;
    const key = extra.join('\u0001');
    if (_layerRe.key !== key || !_layerRe.re) {
        _layerRe = {
            key,
            re: new RegExp('^([^\\s·・:：]{1,12})\\s*[·・:：]\\s*(' + layerAlternation(layers) + ')\\s+(.+)$'),
        };
    }
    return _layerRe.re;
}

/**
 * 「长得像我们的行、但写错了」的**松散**正则 —— 只少了层名后那个必需的空格。
 *
 * ★ 用途：**只有这种行才配被标红**。
 *   反例（绝不能标红）：模型思考块里的普通散文 —— 它们和分镜格式毫无关系，
 *   刷红只会把整段思考内容变成一屏「格式错误」（真机踩过，就是这个现象）。
 */
export function looseRegexFor(layers) {
    const extra = (layers || LAYERS).filter(l => LAYERS.indexOf(l) < 0);
    const key = extra.join('\u0001');
    if (_looseRe.key !== key || !_looseRe.re) {
        _looseRe = {
            key,
            re: new RegExp('^([^\\s·・:：]{1,12})\\s*[·・:：]\\s*(' + layerAlternation(layers) + ')\\s*(.*)$'),
        };
    }
    return _looseRe.re;
}

/** 选项行：1. 文本 | 备注 */
export const RE_OPT = /^(\d+)[.、)]\s*(.+?)\s*(?:\|\s*(.*))?$/;

/** 选项行的另一种（预设 `<options>` 块里用的是 `>选项一：[…]`） */
export const RE_OPT_ALT = /^[>＞]\s*(选项?[一二三四五六七八九十\d]+|\d+)\s*[:：]\s*(.+)$/;

/** 标记区 —— **两种写法都认**：
 *   · `[FRONTEND]…[/FRONTEND]`  ← 我们自己的正则（R2/R3）替换出来的，DOM 后处理路径会看到
 *   · `<htmlcontent>…</htmlcontent>` ← 预设原样输出的，**渲染漏斗钩子**路径看到的是这个
 *     （钩子在 messageFormatting 开头跑，那时正则还没跑，所以标记还没被换掉）
 */
export const RE_FRONTEND_BLOCK = /\[FRONTEND\]([\s\S]*?)\[\/FRONTEND\]/g;
export const RE_OPTIONS_BLOCK = /\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/g;
export const RE_HTMLCONTENT_BLOCK = /<htmlcontent>([\s\S]*?)<\/htmlcontent>/gi;
export const RE_OPTIONS_TAG_BLOCK = /<options>([\s\S]*?)<\/options>/gi;

// ---------------------------------------------------------------- 解析

/**
 * 解析一行
 * @returns {{kind:'row',name:string,layer:string,text:string}
 *         | {kind:'narr',body:string}
 *         | {kind:'other',raw:string}}
 */
export function parseLine(line, layers = LAYERS) {
    const n = line.match(RE_NARR);
    if (n) return { kind: 'narr', body: n[1].trim() };

    const r = line.match(rowRegexFor(layers));
    if (r) return { kind: 'row', name: r[1].trim(), layer: r[2], text: r[3].trim() };

    /* 长得像我们的行但写错了（最常见：层名后漏了空格）→ 显式标红，不静默降级 */
    if (line.match(looseRegexFor(layers))) return { kind: 'err', raw: line };

    /* ★ 其余一律当**普通文本原样通过** —— 不再把散文刷成红色。
       （曾经把所有非匹配行都判成「格式错误」，结果模型思考块几百行全红了。） */
    return { kind: 'text', raw: line };
}

/** 这行是不是「我们的行」 */
export function isOurLine(line, layers = LAYERS) {
    const p = parseLine(line, layers);
    return p.kind === 'row' || p.kind === 'narr';
}

/**
 * 从消息原文里切出三段：前端区 / 选项区 / 正文
 * 前端区与选项区的标记**两种写法都认**（见上面四个常量的注释）。
 * 切掉的标记区不进正文，由调用方决定怎么安置（钩子路径：原样拼回；DOM 路径：保留原节点）。
 */
export function splitSections(raw) {
    const text = String(raw == null ? '' : raw);

    const frontend = [];
    const grab = (src, re, sink) => String(src).replace(re, (_m, inner) => { sink.push(inner); return '\n'; });

    let rest = text;
    rest = grab(rest, RE_FRONTEND_BLOCK, frontend);
    rest = grab(rest, RE_HTMLCONTENT_BLOCK, frontend);

    const optionsRaw = [];
    rest = grab(rest, RE_OPTIONS_BLOCK, optionsRaw);
    rest = grab(rest, RE_OPTIONS_TAG_BLOCK, optionsRaw);

    const options = [];
    for (const block of optionsRaw) {
        for (const line of block.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            const m = t.match(RE_OPT) || t.match(RE_OPT_ALT);
            if (!m) continue;
            if (m[1] && m[2]) options.push({ index: String(m[1]).trim(), text: String(m[2]).trim(), note: (m[3] || '').trim() });
        }
    }

    return { body: rest, frontend, options };
}

/**
 * 正文 → 段落分组
 * 空行分段；每组是若干「行对象」；不匹配的行保留为 other（原样输出）
 */
export function parseBlocks(body, layers = LAYERS) {
    const groups = [];
    let cur = [];
    let errs = 0;

    for (const rawLine of String(body == null ? '' : body).split('\n')) {
        const line = rawLine.trim();
        if (line === '') {
            if (cur.length) { groups.push(cur); cur = []; }
            continue;
        }
        const p = parseLine(line, layers);
        if (p.kind === 'err') errs++;
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

/** 层 → CSS 类；自定义层回落到 cd-L-custom（样式靠行内变量） */
export function layerClass(layer) {
    return LAYER_CLS[layer] || 'cd-L-custom';
}

/**
 * ★★ 复刻 ST 的消息消毒器对 class 的处理
 *
 * 实测（`public/scripts/chats.js:1922-1933`）：消息 HTML 里**每一个** class 都会被加上
 * `custom-` 前缀，只放过 `fa-*` / `note-*` / `monospace`：
 *
 *     return 'custom-' + v;
 *
 * ⇒ CSS 必须写 `.custom-cd-root`，写 `.cd-root` **一个选择器都匹配不上**
 *   （真机现象：功能"看起来生效了"——标签被剥、名字和正文黏成一行——但样式全无）。
 *
 * 钩子路径由 ST 自己加前缀；**DOM 降级路径直接写 DOM、不经过消毒器**，所以要用这个函数补上，
 * 两条路径的最终 class 才会一致。
 */
export function stClassPrefix(html) {
    return String(html == null ? '' : html).replace(/class="([^"]*)"/g, (_m, val) => {
        const out = String(val).split(/\s+/).filter(Boolean).map(v =>
            (v.indexOf('fa-') === 0 || v.indexOf('note-') === 0 || v === 'monospace') ? v : ('custom-' + v)
        ).join(' ');
        return 'class="' + out + '"';
    });
}

function rowHTML(r, colorMap, config) {
    const dim = rowDimmed(r, config.onlyChar) ? ' cd-dim' : '';

    if (r.kind === 'narr') {
        return '<div class="cd-row cd-L-narr' + dim + '" style="' + esc(layerVars('旁白', config)) + '">'
            + '<span class="cd-who"></span>'
            + '<span class="cd-body" title="双击复制这一行">' + esc(r.body) + '</span>'
            + '</div>';
    }
    if (r.kind === 'row') {
        const c = colorMap[r.name] || PALETTE[0];
        const lv = layerVars(r.layer, config);
        const css = '--c:' + esc(c) + (lv ? ';' + esc(lv) : '');
        return '<div class="cd-row ' + layerClass(r.layer) + dim + '" style="' + css + '">'
            + '<span class="cd-who">' + esc(r.name) + '</span>'
            + '<span class="cd-body" title="双击复制这一行">' + esc(r.text) + '</span>'
            + '</div>';
    }
    // other：格式不对的行 —— 显式暴露，不静默降级
    if (r.kind === 'err') {
        if (!config.markErrors) return '';
        return '<div class="cd-row cd-err">'
            + '<span class="cd-who">格式错误</span>'
            + '<span class="cd-body">' + esc(r.raw) + '</span>'
            + '</div>';
    }

    /* text：和分镜无关的普通文本（思考块、说明、散文…）—— **原样通过，不刷红**。
       用整行跨两列，保持阅读流不被打断。 */
    return '<div class="cd-line">' + esc(r.raw) + '</div>';
}

/**
 * 分组 → 网格 HTML（**一条消息一个网格**，名字列宽整条统一）
 * @param {string} extrasHTML 追加进 .cd-root **内部**的 HTML（选项按钮）。
 *  ★ 必须放 root 内部：主题变量（--cd-btn-bg / --cd-btn-line / --cd-sub …）定义在 .cd-root 上，
 *    拼在 root 外面就继承不到 → var() 失效 → 选项按钮回落成浏览器默认的白底按钮（真机踩过）。
 */
export function renderGrid(groups, colorMap = {}, config = DEFAULT_CONFIG, extrasHTML = '') {
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
        + (extrasHTML || '')
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

/** 一条消息里「我们的行」的占比 */
export function storyboardStats(groups) {
    let ours = 0, total = 0;
    for (const g of (groups || [])) {
        for (const r of g) {
            total++;
            if (r.kind === 'row' || r.kind === 'narr') ours++;
        }
    }
    return { ours, total, ratio: total ? ours / total : 0 };
}

/**
 * ★ 消息级门槛：占比不够就**整条不碰**。
 *
 * 为什么必须有这一条：模型把思考块写在同一个 mes 里（预设的 `{思考内容}…</konatan_planning~>`）。
 * 只要有一行匹配我们的格式就接管整条消息，思考块几百行就会全变红。
 * 有了门槛：思考块占多数 → 整条原样交给 ST 渲染，我们一个字不改。
 */
export const MIN_LINES = 2;
export const MIN_RATIO = 0.5;

/** 总入口：正文 → 完整 HTML（不含 frontend —— 那块由 index.js 搬 DOM 节点） */
export function renderMessage(body, colorMap = {}, config = DEFAULT_CONFIG, extrasHTML = '') {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const { groups, errs } = parseBlocks(body, allLayers(cfg));
    const names = collectNames(groups);
    const map = resolveColors(names, cfg, colorMap);
    const s = storyboardStats(groups);

    /* 一条「我们的行」都没有 → 什么都不产出（调用方据此决定不碰 DOM）。
       注意判据不能只看 names.length：整条都是散文时 names=[] 但 errs>0，
       那样会把一条普通消息整条刷成红色「格式错误」。 */
    if (s.ours === 0) {
        return { html: null, groups, errs, names, colors: map, skipped: 'no-lines', ...s };
    }

    /* ★ 门槛：行数或占比不够 → 整条不改（思考块、夹杂大段散文的消息走这里） */
    if (s.ours < MIN_LINES || s.ratio < MIN_RATIO) {
        return { html: null, groups, errs, names, colors: map, skipped: 'ratio', ...s };
    }

    return { html: renderGrid(groups, map, cfg, extrasHTML), groups, errs, names, colors: map, skipped: null, ...s };
}

/**
 * ★★ 分段渲染（渲染漏斗钩子专用）—— 解决「思考块 + 正文同处一个 mes」
 *
 * 为什么需要它：消息级门槛（占比 < 50% 就整条不碰）在真机上**太狠** ——
 * 模型把几百行思考块和几行正文写在同一个 `mes` 里，占比只有百分之几，
 * 整条被跳过 → 用户看到的还是裸标签、没美化。
 *
 * 正确做法：**按行切成连续段** ——
 *   · 我们的行 → 合成 `<div class="cd-root">` 网格（上色 / 对齐 / 层样式）
 *   · 其它行   → **原样返回文本**，交给 showdown / ST 正常渲染（思考块、散文完全不受影响）
 */
export function renderSegments(body, colorMap = {}, config = DEFAULT_CONFIG) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const layers = allLayers(cfg);
    const parsed = parseBlocks(body, layers);
    const names = collectNames(parsed.groups);
    const map = resolveColors(names, cfg, colorMap);

    const segments = [];
    let cur = null;
    let curSrcGroup = null;

    const flush = () => {
        if (cur) {
            const n = (cur.kind === 'ours') ? cur.groups.length : cur.lines.length;
            if (n) segments.push(cur);
        }
        cur = null;
        curSrcGroup = null;
    };

    for (const g of parsed.groups) {
        for (const r of g) {
            const ours = (r.kind === 'row' || r.kind === 'narr');
            if (ours) {
                if (!cur || cur.kind !== 'ours') { flush(); cur = { kind: 'ours', groups: [] }; }
                // 源文里换了一个空行块 → 开新组（网格里画分隔线）
                if (curSrcGroup !== g) { cur.groups.push([]); curSrcGroup = g; }
                cur.groups[cur.groups.length - 1].push(r);
            } else {
                if (!cur || cur.kind !== 'text') { flush(); cur = { kind: 'text', lines: [] }; }
                cur.lines.push(String(r.raw));
            }
        }
    }
    flush();

    return {
        segments, names, colors: map, errs: parsed.errs,
        hasOurs: segments.some(s => s.kind === 'ours' && s.groups.length),
    };
}

/**
 * ★ 渲染漏斗钩子路径的入口 —— 返回**整条消息**的 HTML
 *
 * 与 renderMessage 的区别：钩子跑在 messageFormatting 开头，返回的字符串后面还要过
 * showdown + DOMPurify，我们**不能再依赖"保留原 DOM 节点"**，所以前端区要自己原样拼回。
 *
 * @returns {{html:string,names:string[],errs:number,colors:object,sections:object}|null}
 *          null = 这条消息没有我们的行 → 调用方原样返回，一个字节不改
 */
export function renderMessageHTML(rawText, colorMap = {}, config = DEFAULT_CONFIG) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const text = String(rawText == null ? '' : rawText);
    const sections = splitSections(text);

    /* ★ 判据必须用「切完之后」的正文，不能用整条原文。
       反例：标签只出现在 <htmlcontent> / [FRONTEND] 里时，对整条原文 hasOurLines 为真，
       但外壳被切走后正文没有我们的行 → renderMessage 返回 html:null
       → 若继续拼 `'' + 前端 + 选项`，就会返回一个非空字符串，**正文整段丢失**。 */
    if (!hasOurLines(sections.body, allLayers(cfg))) return null;

    /* ★★ 分段渲染：我们的行 → 网格；其它行 → **原样返回文本**（交给 showdown/ST 正常渲染）。
       取代了「占比 < 50% 就整条不碰」那条粗暴门槛 —— 真机上它把正文一起跳过了。 */
    const seg = renderSegments(sections.body, colorMap, cfg);
    if (!seg.hasOurs) return null;

    /* 选项按钮放进**最后一个** ours 段的 .cd-root 内部（否则拿不到主题变量 → 白底默认按钮） */
    const optHTML = sections.options.length ? renderOptions(sections.options, cfg) : '';
    const lastOurs = seg.segments.map(s => s.kind).lastIndexOf('ours');

    const parts = seg.segments.map((s, i) => {
        if (s.kind === 'text') return s.lines.join('\n');                    // 原样，一个字不改
        return renderGrid(s.groups, seg.colors, cfg, i === lastOurs ? optHTML : '');
    });

    let html = parts.join('\n\n');
    for (const f of sections.frontend) html += '\n' + f;          // 前端区：原样，一个字不动

    return { html, names: seg.names, errs: seg.errs, colors: seg.colors, sections, segments: seg.segments };
}

/** 一条消息里有没有「我们的行」（用来决定碰不碰它） */
export function hasOurLines(body, layers = LAYERS) {
    for (const line of String(body == null ? '' : body).split('\n')) {
        const t = line.trim();
        if (t && isOurLine(t, layers)) return true;
    }
    return false;
}

// ---------------------------------------------------------------- L5/L6/L8 配置面

/** 左侧标记可选值（层样式编辑器用） */
export const MARK_OPTIONS = ['none', 'solid', 'dotted', 'double', 'dashed'];

/** 五层的**默认**样式（style.css 的静态值就是这些；配置可逐层覆盖） */
export const DEFAULT_LAYER_STYLES = {
    '台词': { mark: 'none', italic: false },
    '动作': { mark: 'solid', italic: false },
    '感官': { mark: 'dotted', italic: false },
    '心理': { mark: 'double', italic: true },
    '旁白': { mark: 'none', italic: false },
};

/** 导出文件的 schema 版本（导入时校验，避免把旧格式吃进来） */
export const EXPORT_SCHEMA = 'cine-dialogue/config@1';

/** 可配置键白名单（导入只接受这些） */
export function configKeys() {
    return Object.keys(DEFAULT_CONFIG).concat(['charColors', 'perCard', 'onlyChar', 'highlight', 'customLayers']);
}

/**
 * 层 → 行内 CSS 变量（覆盖 style.css 的静态默认）
 * @returns {string} 形如 `--cd-mark:dashed;--cd-italic:italic;`
 */
export function layerVars(layer, config = {}) {
    const merged = { ...(DEFAULT_LAYER_STYLES[layer] || DEFAULT_LAYER_STYLES['旁白']), ...((config.layerStyles || {})[layer] || {}) };
    const hasMark = !!merged.mark && merged.mark !== 'none' && MARK_OPTIONS.indexOf(merged.mark) >= 0;
    /* ★ 关键：没有任何标记时也必须保持 **3px 宽 + transparent**。
       若把 border-style 设成 none，浏览器会把 used border-width 归零 → 该行整体左移 3px，
       和有线行对不齐（这个坑早先在预览里踩过）。所以样式恒为 solid 兜底，用颜色控制可见性。 */
    return '--cd-mark:' + (hasMark ? merged.mark : 'solid')
        + ';--cd-mark-color:' + (hasMark ? 'currentColor' : 'transparent')
        + ';--cd-italic:' + (merged.italic ? 'italic' : 'normal');
}

/**
 * 颜色解析：**用户点名的颜色优先**，其余按出现顺序分配（纯函数）
 */
export function resolveColors(names, config = {}, seed = {}) {
    const fixed = config.charColors || {};
    const palette = (config.palette && config.palette.length) ? config.palette : PALETTE;
    const map = { ...seed };

    // 1) 用户点名的先钉死
    for (const n of names) {
        if (fixed[n]) map[n] = fixed[n];
    }

    // 2) 没点名的按出现顺序拿「还没被占用」的调色板颜色。
    //    ★ 不能按 Object.keys(map).length 取下标 —— 那样「钉死 苏晴」会把 林野 挤到第 2 色。
    //      钉死一个人不该改变别人的颜色。
    const used = new Set(Object.keys(map).map(k => map[k]));
    let k = 0;
    for (const n of names) {
        if (map[n]) continue;
        while (k < palette.length && used.has(palette[k])) k++;
        const color = k < palette.length
            ? palette[k]
            : 'hsl(' + ((k * 137.508) % 360).toFixed(0) + ', 78%, 66%)';
        map[n] = color;
        used.add(color);
        k++;
    }
    return map;
}

/** 自定义层名校验：1–6 字符、不含分隔符与空格、不与内置层重名 */
export function validateLayerName(name, existing = LAYERS) {
    const n = String(name == null ? '' : name).trim();
    if (!n) return { ok: false, error: '层名不能为空' };
    if (/[\s·・:：]/.test(n)) return { ok: false, error: '层名不能含空格或 · ・ : ：' };
    if (n.length > 6) return { ok: false, error: '层名最多 6 个字符' };
    if (existing.indexOf(n) >= 0) return { ok: false, error: '与已有层重名：' + n };
    return { ok: true, name: n };
}

/** 「只看某角色」的凸显判定（旁白不受影响） */
export function rowDimmed(row, onlyChar) {
    if (!onlyChar) return false;
    if (!row || row.kind !== 'row') return false;
    return row.name !== onlyChar;
}

/** 高亮计划：按查询词切成 [{t, hit}]（大小写不敏感，纯函数） */
export function highlightPlan(text, query) {
    const s = String(text == null ? '' : text);
    const q = String(query == null ? '' : query).trim();
    if (!q) return [{ t: s, hit: false }];
    const out = [];
    const lower = s.toLowerCase();
    const lq = q.toLowerCase();
    let i = 0;
    for (;;) {
        const at = lower.indexOf(lq, i);
        if (at < 0) { if (i < s.length) out.push({ t: s.slice(i), hit: false }); break; }
        if (at > i) out.push({ t: s.slice(i, at), hit: false });
        out.push({ t: s.slice(at, at + q.length), hit: true });
        i = at + q.length;
    }
    return out.length ? out : [{ t: s, hit: false }];
}

/** 这一行适不适合当「分段标题」：旁白且不太长 */
export function sceneTitle(row, max = 28) {
    if (!row || row.kind !== 'narr') return '';
    const t = String(row.body || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 这一楼的分段标题（第一条可用旁白） */
export function messageTitle(rows) {
    for (const r of (rows || [])) {
        const t = sceneTitle(r);
        if (t) return t;
    }
    return '';
}

// ---------------------------------------------------------------- L5 导出 / 导入

/** 只导出白名单内的键 */
export function serializeConfig(config = {}) {
    const out = {};
    for (const k of Object.keys(DEFAULT_CONFIG)) {
        if (config[k] === undefined) continue;
        if (k === 'layerStyles' || k === 'palette') continue;
        out[k] = config[k];
    }
    out.layerStyles = config.layerStyles || {};
    out.charColors = config.charColors || {};
    out.perCard = config.perCard || {};
    return JSON.stringify({ schema: EXPORT_SCHEMA, exportedAt: new Date().toISOString(), config: out }, null, 2);
}

/**
 * 解析导入的配置：**只接受白名单键** + 逐项类型校验；
 * 不合格的键丢进 `dropped` —— 不静默接受脏数据。
 */
export function parseConfig(text) {
    let obj;
    try { obj = JSON.parse(String(text == null ? '' : text)); }
    catch (e) { return { ok: false, error: 'JSON 解析失败：' + (e && e.message ? e.message : String(e)) }; }
    if (!obj || typeof obj !== 'object') return { ok: false, error: '不是一个对象' };
    if (obj.schema && obj.schema !== EXPORT_SCHEMA) return { ok: false, error: 'schema 不匹配：' + obj.schema };

    const src = (obj.config && typeof obj.config === 'object') ? obj.config : obj;
    const allowed = configKeys();
    const out = {};
    const dropped = [];

    for (const k of Object.keys(src)) {
        if (allowed.indexOf(k) < 0) { dropped.push(k); continue; }
        const v = src[k];
        const def = DEFAULT_CONFIG[k];
        if (typeof def === 'boolean' && typeof v !== 'boolean') { dropped.push(k); continue; }
        if (typeof def === 'number' && !Number.isFinite(Number(v))) { dropped.push(k); continue; }
        if (typeof def === 'string' && typeof v !== 'string') { dropped.push(k); continue; }
        if (['layerStyles', 'charColors', 'perCard'].indexOf(k) >= 0 && (v === null || typeof v !== 'object' || Array.isArray(v))) { dropped.push(k); continue; }
        out[k] = v;
    }
    return { ok: true, config: out, dropped };
}

/** 统计（面板/排障用） */
export function stats() {
    return { version: VERSION, layers: LAYERS.slice(), palette: PALETTE.slice() };
}
