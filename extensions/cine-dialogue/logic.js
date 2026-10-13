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

export const VERSION = '0.8.49';
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

/**
 * ★ 层名别名表：规范中文层名 ← 各种写法（中文变体 + 英文）。
 *
 * 为什么需要：模型偶尔把层名写成英文 —— 真机见过 `染·action 我低头凑近她的耳畔…`。
 * 原来这种行**匹配不上**就掉进 text 直通 → **标签 `染·action` 原样显示在界面上** ✗
 * 这违反了本项目「标签绝不出现在 UI」的铁律，所以必须容错。
 */
export const LAYER_ALIAS = {
    /* ★ 外部看得见的行为 / 神态（模型爱自创这种层）→ 统一归「动作」。
       「动作」在格式说明里的定义就是「身体在做什么，外部看得见的行为」，神态/表情正属于这一类。 */
    '动作': ['动作', '行动', 'act', 'acts', 'action', 'actions', 'move', 'motion', 'do',
        '眼神', '目光', '神态', '表情', '神情', '神色', '姿态', '举止', '举动', '行为', '反应'],
    '台词': ['台词', '对白', '说话', 'speech', 'speeches', 'dialogue', 'dialog', 'say', 'says', 'talk', 'line', 'lines', 'voice', 'quote'],
    '感官': ['感官', '感受', '感觉', 'sense', 'senses', 'sensory', 'feeling', 'feel', 'body', 'touch'],
    '心理': ['心理', '内心', '想法', '心声', 'mind', 'thought', 'thoughts', 'inner', 'monologue', 'mono', 'psych', 'psyche'],
    '旁白': ['旁白', '叙述', '旁述', '旁的叙述', '旁白叙述', 'narration', 'narrator', 'narrative', 'narr', 'scene', 'desc', 'description', 'aside'],
};

const _aliasMap = (() => {
    const m = new Map();
    for (const canon of Object.keys(LAYER_ALIAS)) {
        for (const w of LAYER_ALIAS[canon]) m.set(String(w).toLowerCase(), canon);
    }
    return m;
})();

/** 把任意层名写法归一到规范中文层名；不是已知层就返回 null */
export function canonLayer(word) {
    return _aliasMap.get(String(word == null ? '' : word).trim().toLowerCase()) || null;
}

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
    rowGap: 0.5,
    /**
     * 角色类型绑色（用户要求）：
     *   · 蓝名单 = 用户角色（自动算入）+ 男性角色
     *   · 紫名单 = 女性 + 扶她角色
     * 名单里没提到的角色，仍按"首次出场顺序"从调色板拿色 ✓
     * 名字用逗号 / 顿号 / 空格分隔都认 ✓
     */
    /**
     * ★ 未标注的**第三人称**段落 ⇒ 当旁白渲染（用户 2026-10-14「旁白问题」）。
     * ★★ 已确认**判据不可靠**（用户 2026-10-14 两次纠正）：中文常省略主语 ——
     * —— 带「我」的句子**不猜**（那是第一人称，模型该写成 `名字·层`）✗
     *    「手指还在发抖。」「视线落在她身上。」**都是第一人称**，却一个「我」字都没有 ✗
     *    ⇒ 拿「我」当判据**根本分不出**"第三人称描写"和"省略主语的第一人称" ✗
     * ⇒ 所以**默认关闭**：插件不该猜（用户明确要求）✗
     *    想用时可在面板打开，但要接受它会把省略主语的第一人称也当旁白 ✗
     */
    narrateUnlabeled: false,
    roleBlueNames: '',
    rolePurpleNames: '',
    roleBlueColor: '#3B82F6',
    rolePurpleColor: '#A855F7',
    /**
     * 宽表格防挤压（只影响**消息里 markdown 渲染出来的表格**）。
     * 为什么需要：showdown 渲染出的宽表格（十几列）在窄容器里，每列会被压到 min-content，
     * 而**中文的 min-content = 一个字宽** ⇒ 一列字竖着排（真机：状态栏表格挤成一列字）。
     * ★ 三道限制把影响面压到最小：
     *   ① **只在真的溢出时**才动手（scrollWidth > 容器宽）⇒ 小表格一个字都不碰
     *   ② **只处理 .mes_text 的直接子级 <table>**（markdown 渲染的）⇒ 卡脚本/状态栏的表格不碰
     *   ③ 面板里可关（关掉即刻恢复原样）
     */
    wrapWideTables: true,
    /**
     * 是否在「空行分组」之间画分隔线。
     * ★ 默认 **false**：模型经常**每行之间都空一行** → 每行各自成一个分组 →
     *   分隔线 + 行间距**双重叠加**，整屏被撑得很散（真机反馈：「间距有点大」）。
     */
    showSeparators: true,
    /** 行高（正文行距；1.9 偏松，1.7 更紧凑） */
    lineHeight: 1.9,
    /** 首行缩进（em） */
    leadIndent: 2,
    /** 只给「真的换行」的段落做缩进 */
    indentOnlyWrapped: true,
    /** 格式错的行要不要标红 */
    markErrors: true,
    /* ---- 思考块兜底（预设覆盖不到时由插件介入）---- */
    /** 'auto' = 只包预设覆盖不到的楼层 | 'always' = 所有楼层都包（换预设/预设那条被关时用） | 'off' = 不管 */
    thinkingWrap: 'auto',
    /** auto 模式下，认为「预设已经管到」的深度。与专属预设那条正则的 maxDepth 保持一致（现为 20） */
    thinkingDepth: 20,
    /** 兜底包出来的 <details> 是否默认展开（默认折叠 = 隐藏） */
    thinkingOpen: false,
    /* ---- 自动修复（模型输出漂移时的有依据补全；默认关）---- */
    /** 'off' 不修 | 'safe' 只修「层名在名字缺」与纯引号行 | 'aggressive' 再把完全没标注的归为旁白 */
    autoRepair: 'safe',
    /** 宽松层名（**默认关**）：认不出的层词也当自定义层渲染。\n     *  为什么默认关：· 也出现在外文名里（阿尔托莉雅·潘德拉贡 说道），\n     *  放开「任意短词」会把这种正文误判成行、静默改写别人的内容 —— 比偶尔露出标签更糟。\n     *  英文层名已由 LAYER_ALIAS 覆盖，不需要靠这一条。 */
    lenientLayers: false,
    /** 思考块的识别正则（捕获组 1 = 要展示的正文；留空 = 不做兜底） */
    thinkingPattern: '\\{思考内容\\}([\\s\\S]*?)<\\/konatan_planning~>',
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
    '正文每一个自然段都是一行「名字·层 内容」，一行只写一个信息：',
    '  ★ 思考阶段就按这个格式规划：先想好每一行是「谁 · 哪一层」，再落笔 —— 别先写散文再转格式。',
    '  名字·台词 「说的话」        ← 台词按需要波动：10 字上下到 50 字，分量足的到 100 字左右',
    '  名字·动作 我做的具体动作     ← 150–300 字（在这个区间里随节奏波动，别每行都一样长），写细节、写过程',
    '  名字·感官 我身体的感受       ← 150–300 字（在这个区间里随节奏波动，别每行都一样长），写触感 / 温度 / 气味 / 声音',
    '  名字·心理 我心里的想法       ← 150–300 字（在这个区间里随节奏波动，别每行都一样长），写犹豫 / 欲望 / 算计',
    '例：',
    '  林婉婷·台词 「不脱。」',
    '  林野·动作 我把林婉婷翻过去，一只手扣住她的腰往下压。',
    '  林婉婷·感官 被含住的那一刻，热度从胸口一直往下走，最后全堆在腿根那一小片。',
    '  苏晴·心理 我不该站在这里，可是脚一步都没往门口挪。',
    '',
    '旁白单独一行：旁白·内容 —— 没有名字字段，【旁白里不许出现「我」】（第三人称）。用于三类：',
    '  · 画面 / 时间 / 地点 / 环境 / 光线 / 气味',
    '  · 第三人称的外部描写（「她乌黑的长发垂到腰际」「那件素袍看不出材质」）——镜头在看，不是她本人在说「我」',
    '  ★ 但凡是某个角色的具体行为 / 内心 / 说话，就必须写 名字·动作 / 名字·心理 / 名字·台词（第一人称「我」），',
    '    不得写成旁白（「女娲坐在矮几前捻起石子」要写「女娲·动作 我坐在矮几前…」，不能写「旁白·女娲坐在…」）',
    '例：旁白·门缝底下那道光暗了一下。',
    '',
    '【人称 · 必须遵守】',
    '1. 每一行里的「我」= 这一行的角色（林野的行里「我」指林野，林婉婷的行里「我」指林婉婷）。',
    '2. 提到别的角色，第一次必须写真实姓名；同一行里再次提到同一个人可以用「他 / 她」，',
    '   但前提是这一行里只出现了这一个「别人」；出现两个或更多时，全部写真实姓名。',
    '3. 称呼（妈 / 婉婷姐 / 老师）可以出现在句子里，但不得当作名字列的标签。',
    '4. 台词里的「我」是说话的那个人；旁白里不许出现「我」。',
    '',
    '【长度】',
    '台词与旁白要短（台词按需要来回波动，10 字上下到 100 字左右）。动作、感官、心理可以长，一行 150–300 字（随节奏波动），',
    '性爱细节全部写在这三层里。',
    '',
    '【硬规则】',
    '1. 层名后必须有一个半角空格，写漏了会被判为格式错误并标红。',
    '2. 层名只能是 台词 / 动作 / 感官 / 心理 / 旁白 这五个，不得自创。',
    '3. 正文里不得出现「名字·层」以外的标记、标签、小标题、列表符号。',
    '4. 不要写颜色、星号、加粗、markdown 项目符号、表格 —— 颜色和样式由插件处理。',
    '5. 不要输出任何解释、前言、后记、分隔线。',
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
 * 面板分组（**纯数据**）：面板字段多了必须分组折叠，否则一屏全是控件。
 * · name  —— 组名（也是 PANEL_FIELDS[].group 的取值）
 * · open  —— 默认是否展开（只开「基本」，其余默认收起）
 * ★ 夹具会断言：**每个字段都有组、每个组都在这里登记** —— 以后加字段忘了标组会直接报错。
 */
export const PANEL_GROUPS = [
    { name: '基本', open: true },
    { name: '排版', open: false },
    { name: '思考块', open: false },
    { name: '模型漂移修复', open: false },
    { name: '提示词', open: false },
    { name: '性能', open: false },
    { name: '交互', open: false },
];
/**
 * 设置面板的字段表（**纯数据**，由 index.js 拿去生成抽屉）
 *
 * 为什么要放在这里：面板 HTML 在 index.js（碰 DOM），但字段定义放纯函数层，
 * 夹具就能断言「每个 key 都真的存在于 DEFAULT_CONFIG」—— 挡住拼错 key 这类静默失效。
 */
export const PANEL_FIELDS = [
    /* ★ 总开关：`group: null` = 不归任何一组，**常驻面板顶部**（全插件的开关不该被折叠藏起来）。
       它不是「只停渲染」：关掉后提示词注入、思考块兜底、双击复制、Alt 跳场景一并停用，
       并把**已经渲染过的楼层恢复成 ST 原生渲染**。 */
    { key: 'enabled', group: null, kind: 'bool', label: '总开关（整个插件）',
      note: '关掉后完全停用：不渲染 / 不注入提示词 / 不介入思考块 / 不接管双击与跳场景；已渲染的楼层会恢复原样' },
    { key: 'narrateUnlabeled', group: '基本', kind: 'bool', label: '未标注的第三人称段落当旁白',
      note: '⚠️ 默认关：中文常省略主语，插件**分不出**「第三人称描写」和「省略主语的第一人称」⇒ 会把第一人称也当旁白 ✗' },
    { key: 'roleBlueNames', group: '基本', kind: 'text', label: '蓝名单（用户/男性角色）',
      note: '逗号分隔；你的用户角色会自动算在内。例：染, 老王' },
    { key: 'rolePurpleNames', group: '基本', kind: 'text', label: '紫名单（女性/扶她角色）',
      note: '逗号分隔。例：沙良, 久美, 沈鹿笙' },
    { key: 'roleBlueColor', group: '基本', kind: 'text', label: '蓝名单用的颜色', note: '十六进制色号，例 #3B82F6' },
    { key: 'rolePurpleColor', group: '基本', kind: 'text', label: '紫名单用的颜色', note: '十六进制色号，例 #A855F7' },
    { key: 'transformUserMessages', group: '基本', kind: 'bool', label: '也渲染用户消息', note: '默认关：你打的是大白话，通常不是分镜格式' },
    { key: 'indentOnlyWrapped', group: '排版', kind: 'bool', label: '首行缩进只给换行的段落', note: '关掉 = 除台词外全部缩进' },
    { key: 'markErrors', group: '基本', kind: 'bool', label: '格式错的行标红', note: '关掉 = 不显示（不推荐，会静默吞掉格式错误）' },
    { key: 'nameColMode', group: '排版', kind: 'select', label: '名字列宽', note: 'auto = 按整条消息最长名字',
      options: [['auto', '自动（推荐）'], ['left', '自动（同左）'], ['fixed', '固定像素']] },
    { key: 'nameColWidth', group: '排版', kind: 'number', label: '固定宽度', unit: 'px', min: 40, max: 400, step: 4, when: 'nameColMode=fixed' },
    { key: 'rowGap', group: '排版', kind: 'number', label: '行间距', unit: 'em', min: 0, max: 3, step: 0.1 },
    { key: 'lineHeight', group: '排版', kind: 'number', label: '行高', unit: '倍', min: 1.2, max: 2.6, step: 0.05 },
    { key: 'wrapWideTables', group: '排版', kind: 'bool', label: '宽表格防挤压',
      note: '只对**真的溢出**的消息表格生效（十几列的宽表变成可横向拖，字不再竖排）；小表格与卡的状态栏不碰' },
    { key: 'showSeparators', group: '排版', kind: 'bool', label: '空行分组之间画分隔线',
      note: '默认关：模型常每行都空一行 → 分隔线会与行间距叠加，整屏被撑散' },
    { key: 'leadIndent', group: '排版', kind: 'number', label: '首行缩进', unit: 'em', min: 0, max: 4, step: 0.5 },

    /* ---- L3 提示词层 ---- */
    { key: 'thinkingWrap', group: '思考块', kind: 'select', label: '思考块兜底',
      note: '预设那条思维链正则只覆盖最近 2 层；更早的层由插件折叠（消费掉标记后预设不会重复包装）',
      options: [['auto', '自动（只补预设覆盖不到的）'], ['always', '全部楼层都由插件包'], ['off', '不管']] },
    { key: 'thinkingDepth', group: '思考块', kind: 'number', label: '预设已覆盖的深度', unit: '层', min: 0, max: 50, step: 1 },
    { key: 'thinkingOpen', group: '思考块', kind: 'bool', label: '兜底的思考默认展开', note: '默认关 = 折叠隐藏' },
    { key: 'thinkingPattern', group: '思考块', kind: 'text', label: '思考块识别正则', note: '捕获组 1 = 展示正文；留空 = 不做兜底' },
    { key: 'lenientLayers', group: '模型漂移修复', kind: 'bool', label: '宽松层名（认不出的层当自定义层）',
      note: '关掉后：层名不是内置层/别名时该行退回普通文本 → **标签会原样显示**。建议保持开启' },
    { key: 'autoRepair', group: '模型漂移修复', kind: 'select', label: '自动修复模型漂移',
      note: 'safe：只修「只写了层名」与纯引号行（有依据）；aggressive：再把完全没标注的归为旁白（不猜角色）',
      options: [['off', '不修'], ['safe', 'safe（有依据才修）'], ['aggressive', 'aggressive（再归旁白）']] },
    { key: 'injectPrompt', group: '提示词', kind: 'bool', label: '自动注入格式说明',
      note: '默认关：专属预设里已有同样说明，两边同时开会重复占提示词' },
    { key: 'promptDepth', group: '提示词', kind: 'number', label: '注入深度', unit: '层', min: 0, max: 20, step: 1 },
    { key: 'promptPosition', group: '提示词', kind: 'select', label: '注入位置',
      options: [['0', '系统提示内'], ['1', '对话内（更靠后）']] },

    /* ---- L5 数据层 ---- */
    { key: 'maxRenderFloors', group: '性能', kind: 'number', label: '批量渲染上限', unit: '楼',
      min: 0, max: 2000, step: 20, note: '0 = 不限；只影响 DOM 降级路径，装了核内钩子时由 ST 自己按窗口渲染' },

    /* ---- L2 交互层 ---- */
    { key: 'copyOnClick', group: '交互', kind: 'bool', label: '双击复制该行', note: '关掉 = 双击不复制（Alt+↑/↓ 跳场景不受影响）' },
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


/** 旁白·内容 —— 没有名字字段 */
export const RE_NARR = /^旁白\s*[·・:：]\s*(.+)$/;

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 层名分支：内置四层 + 自定义层。
 *  ★ 不能用 ['台词','动作','感官','心理'].join('|') + '|' + extra.join('|') ——
 *    自定义层为空时会在尾部留下一个 `|`，产生**空层名分支**，
 *    于是 `林野· 内容`（漏了层名）会被当成**合法行**而不是格式错误。 */
/** 内置层 + 别名 + 自定义层 → 正则用的**非捕获**分支（不许多出捕获组，否则 r[2]/r[3] 会错位） */
function layerWordAlternation(layers, lenient) {
    const words = [];
    const push = w => { const s = String(w == null ? '' : w).trim(); if (s && words.indexOf(s) < 0) words.push(s); };
    for (const L of (layers || LAYERS)) {
        push(L);
        for (const a of (LAYER_ALIAS[L] || [])) push(a);
    }
    const list = words.map(escRe).join('|');
    /* lenient：再接受**任意短词**（≤8 字符、无分隔符）→ 由 parseLine 落成「自定义层」。
       这样即使层名是没见过的写法，也**不会把标签露在界面上**。 */
    return lenient ? '(?:' + list + '|[^\\s·・:：]{1,8})' : '(?:' + list + ')';
}

/** 层名分支（不含「任意短词」那一条）—— 给「松散匹配/修复」这类需要严格层名的场景用 */
function layerAlternation(layers) {
    return layerWordAlternation(layers, false);
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
     这是夹具抓到的真 bug：结果「层名后漏空格」这种最常见的格式错误根本标不出来。
   ★ key 里必须带上 lenient 标志 —— 否则两种模式的缓存会互相覆盖。 */
let _layerRe = { key: null, re: null };
let _looseRe = { key: null, re: null };

/** 取「认哪些层」的行正则（含别名；lenient 时再接受任意短词） */
export function rowRegexFor(layers, lenient = false) {
    const key = (layers || LAYERS).join('\u0001') + '\u0002' + (lenient ? '1' : '0');
    if (_layerRe.key !== key || !_layerRe.re) {
        _layerRe = {
            key,
            re: new RegExp('^([^\\s·・:：*#>\\[\\]{}()=+~`|,，.。!！?？-][^·・:：\\n]{0,15}?)\\s*[·・:：]\\s*(' + layerWordAlternation(layers, lenient) + ')\\s+(.+)$'),
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
export function looseRegexFor(layers, lenient = false) {
    const key = (layers || LAYERS).join('\u0001') + '\u0002' + (lenient ? '1' : '0');
    if (_looseRe.key !== key || !_looseRe.re) {
        _looseRe = {
            key,
            re: new RegExp('^([^\\s·・:：*#>\\[\\]{}()=+~`|,，.。!！?？-][^·・:：\\n]{0,15}?)\\s*[·・:：]\\s*(' + layerWordAlternation(layers, lenient) + ')\\s*(.*)$'),
        };
    }
    return _looseRe.re;
}

/** 选项行：1. 文本 | 备注 */
export const RE_OPT = /^([A-Za-z]|\d+)[.、)]\s*(.+?)\s*(?:\|\s*(.*))?$/;

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
export function parseLine(line, layers = LAYERS, lenient = false) {
    const n = line.match(RE_NARR);
    if (n) return { kind: 'narr', body: n[1].trim() };

    /* ★★ 模型有时把**层名写在 · 前面**、而且 `·` 后面**没有空格**（层名和正文黏在一起）：
          `旁的叙述·染开始加速前后冲送。他的腰肢…`
       这种行原来会掉进 text 直通 ⇒ **整行标签露在界面上** ✗（真机截图）。
       判据（两条都要满足，与下面的守卫式兜底同源）：
         · `·` 前面那个词能归一到**已知层名**（含别名，如「旁的叙述」→ 旁白）
         · `·` 后面**至少 12 个字符** —— 挡住「外文名里的间隔号」这类误判
       ⇒ 当「该层名 + 没有名字」处理：旁白走 narr（本来就没有名字格 ✓），其余层走 row（名字为空）。
       ★ 顺序很关键：必须在 RE_NARR 之后、rowRegexFor 之前 —— 否则会抢掉正常的 `名字·层 内容`。 */
    const layerFirst = line.match(/^([^·・:：\n]{2,8})\s*[·・:：]\s*([\s\S]{12,})$/);
    if (layerFirst) {
        const canonFirst = canonLayer(layerFirst[1]);
        if (canonFirst) {
            const body = layerFirst[2].trim();
            if (canonFirst === '旁白') return { kind: 'narr', body };
            return { kind: 'row', name: '', layer: canonFirst, text: body, repaired: 'layer-only', rawLayer: layerFirst[1] };
        }
    }

    const r = line.match(rowRegexFor(layers, lenient));
    if (r) {
        const raw = r[2];
        const canon = canonLayer(raw);
        if (canon) {
            /* 本来就是规范层名 → 原样返回（**不许多出键**，否则深度相等断言会全线失配） */
            if (canon === raw) return { kind: 'row', name: r[1].trim(), layer: canon, text: r[3].trim() };
            /* 别名（如英文 action）→ 归一到规范层名，留 alias 记号让用户知道是插件翻译的 */
            return { kind: 'row', name: r[1].trim(), layer: canon, text: r[3].trim(), repaired: 'alias', rawLayer: raw };
        }
        /* 认不出的层词 → 当**自定义层**渲染（名字列/颜色保留，层名不展示）。
           ★ 守住铁律「标签绝不出现在 UI」：宁可当自定义层，也不能把 `染·action` 原样露出来。 */
        return {
            kind: 'row', name: r[1].trim(), layer: raw, text: r[3].trim(),
            repaired: 'unknown-layer', rawLayer: raw,
        };
    }

    /* 长得像我们的行但写错了（最常见：层名后漏了空格）→ 显式标红，不静默降级 */
    if (line.match(looseRegexFor(layers))) return { kind: 'err', raw: line };

    /* ★ 其余一律当**普通文本原样通过** —— 不再把散文刷成红色。
       （曾经把所有非匹配行都判成「格式错误」，结果模型思考块几百行全红了。） */
    /* ★★ 守卫式兜底：认不出的层词也要渲染成行 —— **绝不让标签露在界面上**。
       判据（两条都要满足）：
         · 层词是 2–6 个非分隔符字符（模型自创的层名，如「眼神」「外貌」）
         · 正文**至少 12 个字符** —— 这条用来排除「外文名里的间隔号」：
           `阿尔托莉雅·潘德拉贡 说道` 的正文只有「说道」两字 ⇒ 不满足 ⇒ 不会被误判成行 ✓
       （真机踩过：`女娲·眼神 从她那双淡金色的眸子里…` 整行露着标签。） */
    const guarded = line.match(new RegExp('^([^\\s·・:：*#>\\[\\]{}()=+~`|,，.。!！?？-][^·・:：\\n]{0,15}?)\\s*[·・]\\s*([^\\s·・:：]{2,6})\\s+([\\s\\S]{12,})$'));
    if (guarded) {
        return {
            kind: 'row', name: guarded[1].trim(), layer: guarded[2], text: guarded[3].trim(),
            repaired: 'unknown-layer', rawLayer: guarded[2],
        };
    }

    return { kind: 'text', raw: line };
}

/** 这行是不是「我们的行」 */
export function isOurLine(line, layers = LAYERS, lenient = false) {
    const p = parseLine(line, layers, lenient);
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
    /* ★★ 认不出的行**绝不能丢**（真机踩到：模型用 `A. …` / `B. …` 写选项 ⇒
       原来的两个正则（`^(\d+)[.、)]` 与 `^[>＞]`）都不认 ⇒ 而整个 `<options>` 块
       已经从正文里删掉了 ⇒ **内容彻底消失** ✗✗）
       现在：认得出的做成按钮 ✓，认不出的**原样还回正文** ✓ —— 永不丢字 */
    const leftover = [];
    /* 包装行（<options> / </options> / [OPTIONS] / [FRONTEND] …）本身不是内容 ⇒ 丢掉；
       其余**认不出的行一律还回正文** ✓（永不丢字） */
    const WRAP = /^\s*(\[\s*\/?\s*(OPTIONS|FRONTEND)\s*\]|<\/?\s*(options|htmlcontent)\s*>)\s*$/i;
    for (const block of optionsRaw) {
        for (const line of block.split('\n')) {
            const t = line.trim();
            if (!t || WRAP.test(t)) continue;
            const m = t.match(RE_OPT) || t.match(RE_OPT_ALT);
            if (m && m[1] && m[2]) options.push({ index: String(m[1]).trim(), text: String(m[2]).trim(), note: (m[3] || '').trim() });
            else leftover.push(t);
        }
    }
    const body = leftover.length ? (rest.replace(/\s*$/, '') + '\n\n' + leftover.join('\n')) : rest;

    return { body, frontend, options };
}

/**
 * 正文 → 段落分组
 * 空行分段；每组是若干「行对象」；不匹配的行保留为 other（原样输出）
 */
export function parseBlocks(body, layers = LAYERS, cfg = null) {
    const groups = [];
    let cur = [];
    let errs = 0;

    for (const rawLine of String(body == null ? '' : body).split('\n')) {
        const line = rawLine.trim();
        if (line === '') {
            if (cur.length) { groups.push(cur); cur = []; }
            continue;
        }
        const p = parseLine(line, layers, !!(cfg && cfg.lenientLayers));
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

/**
 * 未标注行（text 直通）用的**空锚点**。
 *
 * 为什么要锚点：这些行必须留在网格**外面**（进去就没 markdown 了），于是它们从 x=0 开始，
 * 和正文列（网格第 2 列，带 3px 边框 + .7em 内边距）对不齐 —— 真机反馈：
 * 「旁白没有和上面/后面的内容对齐」。
 * 解法：在每段前面放一个空 span 当**锚**，渲染后由 decorate() 量出正文列的实际位置，
 * 再把锚点之后、下一个锚点/网格之前的兄弟节点统一加左内边距。既不包内容（markdown 不受影响），
 * 也不用猜哪些节点是"我们的"。
 */
export const PLAIN_ANCHOR = '<span class="cd-anchor" aria-hidden="true"></span>';
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

/** 修复痕迹的 hover 说明（**必须可见**：让用户随时能分辨哪些是模型写的、哪些是插件补的） */
function fixTitle(r) {
    const repaired = (r && r.repaired) || null;
    const rawLayer = (r && r.rawLayer) || '';
    switch (repaired) {
        case 'name': return '这一行的「名字·」是模型漏写的，插件按同楼最近标注过的角色补上';
        case 'quote': return '这一行没有层名，插件按引号判为「台词」，名字按同楼最近标注过的角色补上';
        case 'layer-only': return '这一行只有层名、没有名字（插件不猜角色，就按写明的那个层渲染）';
        case 'bare': return '这一行完全没标注，插件按「不猜角色」的原则归为「旁白」';
        case 'alias': return '这一行的层名是非规范写法（英文或别名），插件已自动归一到对应中文层';
        case 'unknown-layer': return '这一行的层名不在内置层里，插件按**自定义层**渲染（层名不显示，可在原文里核对）';
        default: return '';
    }
}

function rowHTML(r, colorMap, config) {
    const dim = rowDimmed(r, config.onlyChar) ? ' cd-dim' : '';
    const fix = r.repaired ? ' cd-fix' : '';
    const fixTip = fixTitle(r);

    if (r.kind === 'narr') {
        return '<div class="cd-row cd-L-narr' + dim + fix + '" style="' + esc(layerVars('旁白', config)) + '">'
            + '<span class="cd-who"' + (fixTip ? ' title="' + esc(fixTip) + '"' : '') + '></span>'
            + '<span class="cd-body" title="双击复制这一行">' + esc(r.body) + '</span>'
            + '</div>';
    }
    if (r.kind === 'row') {
        const c = colorMap[r.name] || PALETTE[0];
        const lv = layerVars(r.layer, config);
        const css = '--c:' + esc(c) + (lv ? ';' + esc(lv) : '');
        return '<div class="cd-row ' + layerClass(r.layer) + dim + fix + '" style="' + css + '">'
            + '<span class="cd-who' + (r.name ? '' : ' cd-noname') + '"' + (fixTip ? ' title="' + esc(fixTip) + '"' : '') + '>' + esc(r.name) + '</span>'
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
        + '--cd-indent:' + Number(cfg.leadIndent) + 'em;'
        + '--cd-lh:' + Number(cfg.lineHeight) + ';';
    const mode = cfg.nameColMode === 'fixed' ? 'fixed' : 'auto';
    const fixed = mode === 'fixed' ? ' style="--cd-namew:' + Number(cfg.nameColWidth) + 'px"' : '';

    const rowsHTML = groups.map((g, gi) =>
        ((gi > 0 && cfg.showSeparators) ? '<div class="cd-sep"></div>' : '') + g.map(r => rowHTML(r, colorMap, cfg)).join('')
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

    /* ★ 选项按钮带**行内 style**。
       为什么：消息消毒器只拦截 class（改成 custom- 前缀），**不碰 style**，而行内样式优先级最高。
       这样无论 class 怎么被改、宿主样式怎么覆盖，按钮都不会退化成浏览器默认的**白底**按钮。
       （真机踩过：一排白盒子 —— 用户关掉本插件白盒子就消失，证明就是我们画的按钮没拿到样式。）

       也不要写 `background: rgba(255,255,255,.04)` 那种"几乎透明"的值 ——
       一旦没生效根本看不出来。这里用**半透明灰**：暗色页上是淡暗块，亮色页上是淡灰块。 */
    const BTN_CSS = [
        'display:flex', 'align-items:baseline', 'gap:.7em', 'width:100%',
        'text-align:left', 'cursor:pointer', 'font:inherit', 'font-size:.9em',
        'padding:.5em .8em', 'border-radius:.3em', 'color:inherit',
        'border:1px solid rgba(128,140,160,.38)', 'background:rgba(128,140,160,.16)',
    ].join(';');

    const btns = options.map(o =>
        '<button type="button" class="cd-opt" data-cd-text="' + esc(o.text) + '" style="' + BTN_CSS + '">'
        + '<span class="cd-opt-i" style="opacity:.6;font-size:.85em;min-width:1.4em">' + esc(o.index) + '.</span>'
        + '<span class="cd-opt-t" style="flex:1 1 auto">' + esc(o.text) + '</span>'
        + (o.note ? '<span class="cd-opt-n" style="opacity:.55;font-size:.8em">' + esc(o.note) + '</span>' : '')
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
/**
 * 把 markdown 图片 `![alt](url)` 变成真的 `<img>`。
 *
 * 为什么必须做（真机实测）：我们交给 ST 的是**一整块 HTML** ⇒ showdown **不再解析块内的 markdown** ✗
 * ⇒ 原样的 `![pic435](https://…)` 会以**字面文字**露出来 ✗
 * （独立一行、夹在句子里，两种都中招 —— 实测过，不是猜的。）
 *
 * 安全：只认 `http(s)://` 与 `data:image/…;base64,…` —— 其它一律**原样不动**（不转换）✓
 * 属性值走 esc() 转义 ✓；最终还有 ST 自己的 DOMPurify 兜一道 ✓
 */
export function renderInlineImages(text) {
    const RE = /!\[([^\]]{0,120})\]\(\s*(https?:\/\/[^\s)]{1,2000}|data:image\/[a-z+.\-]{1,20};base64,[A-Za-z0-9+/=]{1,500000})\s*\)/g;
    return String(text == null ? '' : text).replace(RE, (m0, alt, url) =>
        '<img class="cd-img" src="' + esc(url) + '" alt="' + esc(alt) + '" loading="lazy">');
}

export function renderSegments(body, colorMap = {}, config = DEFAULT_CONFIG) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const layers = allLayers(cfg);
    const rawLines = String(body == null ? '' : body).split('\n');

    /* ★ 按**原始行**走一遍，而不是走 parseBlocks 的分组结果 ——
       分组会吃掉空行、把每行 trim 掉；而 text 段是「原样交给 showdown」的，
       必须**连空行与行首空格一起保留**（思考块 `{思考内容}…</konatan_planning~>` 就在 text 段里，
       预设那条思维链正则 `([\s\S]*)</konatan_planning~>` 靠它匹配）。 */
    /* autoRepair != off 时，先走一遍「有依据的补全」（见 repairLines） */
    const entries = (String(cfg.autoRepair || 'off') === 'off')
        ? rawLines.map(raw => {
            const t = raw.trim();
            if (t === '') return { kind: 'blank', raw };
            return { p: parseLine(t, layers, !!cfg.lenientLayers), raw };
        })
        : repairLines(rawLines, cfg).map(x => x.p.kind === 'blank' ? { kind: 'blank', raw: x.line } : { p: x.p, raw: x.line, repaired: x.repaired });

    const names = [];
    const seen = new Set();
    for (const e of entries) {
        if (e.p && e.p.kind === 'row' && !seen.has(e.p.name)) { seen.add(e.p.name); names.push(e.p.name); }
    }
    const map = resolveColors(names, cfg, colorMap);

    const segments = [];
    let cur = null;
    let errs = 0;

    const flush = () => {
        if (cur) {
            const n = (cur.kind === 'ours') ? cur.groups.length : cur.lines.length;
            if (n) segments.push(cur);
        }
        cur = null;
    };

    for (const e of entries) {
        if (e.kind === 'blank') {
            /* 空行：text 段里**原样保留**；ours 段里只作为分组边界（供 showSeparators 用） */
            if (cur && cur.kind === 'text') cur.lines.push('');
            else if (cur && cur.kind === 'ours') cur.pendingBreak = true;
            continue;
        }

        const ours = (e.p.kind === 'row' || e.p.kind === 'narr');
        if (e.p.kind === 'err') errs++;

        if (ours) {
            if (!cur || cur.kind !== 'ours') { flush(); cur = { kind: 'ours', groups: [] }; }
            if (!cur.groups.length || cur.pendingBreak) { cur.groups.push([]); cur.pendingBreak = false; }
            cur.groups[cur.groups.length - 1].push(e.p);
        } else {
            if (!cur || cur.kind !== 'text') { flush(); cur = { kind: 'text', lines: [] }; }
            cur.lines.push(e.raw);          // ★ 原样，不 trim
        }
    }
    flush();

    return {
        segments, names, colors: map, errs,
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
export function renderMessageHTML(rawText, colorMap = {}, config = DEFAULT_CONFIG, opts = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const text = String(rawText == null ? '' : rawText);
    const sections = splitSections(text);

    /* ★ 判据必须用「切完之后」的正文，不能用整条原文。
       反例：标签只出现在 <htmlcontent> / [FRONTEND] 里时，对整条原文 hasOurLines 为真，
       但外壳被切走后正文没有我们的行 → renderMessage 返回 html:null
       → 若继续拼 `'' + 前端 + 选项`，就会返回一个非空字符串，**正文整段丢失**。 */
    /* ★★ 有选项块的楼**也要接手** —— 用户报「选择状态栏消失了」：
       卡自己没有选择状态栏时，选项栏就是**我们提供的功能** ✓（原来这里只有"有我们的行才接手" ✗） */
    const hasOpts = sections.options.length > 0;
    if (!hasOurLines(sections.body, allLayers(cfg)) && !hasOpts) return null;

    /* ★★ 分段渲染：我们的行 → 网格；其它行 → **原样返回文本**（交给 showdown/ST 正常渲染）。
       取代了「占比 < 50% 就整条不碰」那条粗暴门槛 —— 真机上它把正文一起跳过了。 */
    /* ★ 未标注的第三人称段落 ⇒ 先改写成 `旁白·…`，再进正常渲染（对齐 / 样式都跟着走） */
    if (cfg.narrateUnlabeled) {
        const narr = narratePlain(sections.body, allLayers(cfg));
        if (narr !== sections.body) { sections.body = narr; }
    }
    const seg = renderSegments(sections.body, colorMap, cfg);
    if (!seg.hasOurs && !hasOpts) return null;

    /* 选项按钮放进**最后一个** ours 段的 .cd-root 内部（否则拿不到主题变量 → 白底默认按钮） */
    const optHTML = sections.options.length ? renderOptions(sections.options, cfg) : '';
    const lastOurs = seg.segments.map(s => s.kind).lastIndexOf('ours');

    const parts = seg.segments.map((s, i) => {
        if (s.kind === 'text') {
            const raw = s.lines.join('\n');                                  // 原样，一个字不改
            const body = opts.wrapThinking ? wrapThinkingBlock(raw, cfg) : raw;   // ← 预设覆盖不到时由我们折叠
            return PLAIN_ANCHOR + '\n' + renderInlineImages(body);   // 锚点：供 decorate() 对齐；顺带把 markdown 图片变成 <img>
        }
        return renderGrid(s.groups, seg.colors, cfg, i === lastOurs ? optHTML : '');
    });

    let html = parts.join('\n\n');
    /* ★ 整楼没有我们的行、但有选项 ⇒ 选项单独放进一个 cd-root：
       这样它能拿到 --cd-* 主题变量，**不会变成白底默认按钮** ✗（真机踩过） */
    if (hasOpts && lastOurs < 0) html = (html ? html + '\n\n' : '') + renderGrid([], colorMap, cfg, optHTML);
    for (const f of sections.frontend) html += '\n' + f;          // 前端区：原样，一个字不动

    return { html, names: seg.names, errs: seg.errs, colors: seg.colors, sections, segments: seg.segments };
}

/** 一条消息里有没有「我们的行」（用来决定碰不碰它） */
/**
 * 把「未标注的第三人称段落」改写成 `旁白·内容`（用户要求）。
 * 保守判据 —— 任一条不满足就**原样返回**（不猜 ✗）：
 *   · 已是我们格式的行（`名字·层 内容` / `旁白·…`）⇒ 不动
 *   · 含「我 / 咱 / 俺 / 我们」⇒ 第一人称 ⇒ 不动（那该由模型写成 `名字·层`）
 *   · 含 `< > | · * # [ ]`（结构块 / markdown / 表格 / 间隔号）⇒ 不动
 *   · 以引号 / 括号 / 列表符号开头 ⇒ 不动（可能是对白或列表）
 *   · 去空白后不足 8 字 ⇒ 不动
 */
export function narratePlain(body, layers = LAYERS) {
    return String(body == null ? '' : body).split('\n').map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (isOurLine(t, layers)) return line;
        if (/[我咱俺]/.test(t)) return line;
        if (/[<>|·*#\[\]{}]/.test(t)) return line;
        if (/^[「」『』“”"'（）()【】\-—>•\d]/.test(t)) return line;
        if (t.length < 8) return line;
        return '旁白·' + t;
    }).join('\n');
}

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
    /* ★ 关键：没有任何标记时也必须保持**同样的宽度 + transparent**。
       若把 border-style 设成 none，浏览器会把 used border-width 归零 → 该行整体左移，
       和有线行对不齐（这个坑早先在预览里踩过）。所以样式恒为 solid 兜底，用颜色控制可见性。 */
    /* ★ 双线必须**加宽**才看得见：`border-style: double` 在 3px 下是 1px 线 + 1px 隙 + 1px 线，
       抗锯齿之后和实线几乎分不出来（真机反馈：「心理和动作的线区别不大」）。
       5px = 2px + 1px + 2px 才清楚。加宽会挤走文字，所以同时输出 --cd-pad-comp 把内边距补回来，
       五层正文的左边缘**必须完全对齐**。 */
    const isDouble = hasMark && merged.mark === 'double';
    return '--cd-mark:' + (hasMark ? merged.mark : 'solid')
        + ';--cd-mark-color:' + (hasMark ? 'currentColor' : 'transparent')
        + ';--cd-italic:' + (merged.italic ? 'italic' : 'normal')
        + ';--cd-mark-w:' + (isDouble ? 5 : 3) + 'px'
        + ';--cd-pad-comp:' + (isDouble ? 2 : 0) + 'px';
}

/**
 * 颜色解析：**用户点名的颜色优先**，其余按出现顺序分配（纯函数）
 */
/**
 * 从文本里猜某人的性别类别（纯函数，可夹具）。
 * 用户提示：人格描述里就写着「染是一名男性」✓ 卡描述/世界书里也有这类信息 ✓
 * 判据：在**名字附近**的窗口里找关键词 ⇒ 返回 male / female / futa / 空串（判不出）
 * ★ 只用于**自动给颜色**；用户在面板填的名单**优先** ✓
 */
export function guessGenderFromText(name, text) {
    const n = String(name == null ? '' : name).trim();
    const s = String(text == null ? '' : text);
    if (!n || !s) return '';
    let i = s.indexOf(n);
    while (i >= 0) {
        const win = s.slice(Math.max(0, i - 24), i + n.length + 72);
        if (/扶她|雙性|双性|阴阳同体|雌雄同体|futa/i.test(win)) return 'futa';
        if (/男性|男的|男子|少年|雄性|公的/.test(win)) return 'male';
        if (/女性|女的|女子|少女|雌性|母的|人妻|姑娘|女友|女儿|姐姐|阿姨|妈妈|师姐|师妹/.test(win)) return 'female';
        i = s.indexOf(n, i + 1);
    }
    return '';
}

/** 把「甲,乙、丙 丁」这种名单拆成数组（逗号 / 顿号 / 空格 / 分号都认） */
export function parseNameList(text) {
    return String(text == null ? '' : text).split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean);
}

export function resolveColors(names, config = {}, seed = {}) {
    const fixed = config.charColors || {};
    const palette = (config.palette && config.palette.length) ? config.palette : PALETTE;
    const map = { ...seed };

    // 0) ★ 角色类型绑色（用户要求）：蓝名单 = 用户+男性；紫名单 = 女性+扶她
    const blueList = parseNameList(config.roleBlueNames);
    const purpleList = parseNameList(config.rolePurpleNames);
    const cBlue = config.roleBlueColor || '#3B82F6';
    const cPurple = config.rolePurpleColor || '#A855F7';
    for (const n of names) {
        if (map[n]) continue;
        if (blueList.indexOf(n) >= 0) map[n] = cBlue;
        else if (purpleList.indexOf(n) >= 0) map[n] = cPurple;
    }

    // 1) 用户点名的先钉死
    for (const n of names) {
        if (fixed[n]) map[n] = fixed[n];
    }

    // 2) 没点名的按**顺序**拿「还没被占用」的调色板颜色 —— 这是用户熟悉的那套 ✓
    //    ★ 顺序从哪来：seed 里带着 settings.charColors（已钉死的 ✓）
    //      ⇒ "第一个**新见到的**角色"拿第一个未用色 ⇒ 主角/最早出场者 = 第 1 色（青）✓
    //      然后 pinColors 立刻钉进 charColors ⇒ **以后永远不变** ✓✓
    //    （0.8.14 用"名字哈希"是错的 ✗：那只是把颜色换成另一套，不是恢复用户那套 ✗）
    const used = new Set(Object.keys(map).map((k) => map[k]));
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

// ---------------------------------------------------------------- 思考块兜底（预设覆盖不到时由插件介入）

/**
 * 把思考块包成**原生 `<details>`**（默认折叠 ⇒ 天然隐藏，**不依赖任何 CSS**）。
 *
 * 为什么需要：预设那条 `1美化最近二层思维链` 带 `maxDepth: 2` ——
 * **只美化最近 2 层**，更早的楼思考原样显示（真机反馈：「上面的思考没隐藏」）。
 * 本函数让插件在**预设覆盖不到的地方**补上，两者互补：
 *   预设管 depth ≤ N，我们管 depth > N；我们消费掉标记后预设自然不再匹配，**不会双重包装**。
 *
 * @param {string} text  文本段原文（逐字节保真的那份）
 * @param {object} config 读 thinkingPattern / thinkingOpen
 * @returns {string}
 */
export function wrapThinkingBlock(text, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const src = String(text == null ? '' : text);
    const pattern = String(cfg.thinkingPattern || '').trim();
    if (!pattern) return src;

    let re;
    try {
        re = new RegExp(pattern, 'g');
    } catch (e) {
        /* 正则被写坏 → **原样返回**：绝不因为一个兜底功能把别人的内容弄丢 */
        console.warn('[' + EXT_ID + '] thinkingPattern 不是合法正则，已跳过思考块兜底：', e && e.message);
        return src;
    }

    const openAttr = cfg.thinkingOpen ? ' open' : '';
    return src.replace(re, function () {
        const args = Array.prototype.slice.call(arguments);
        const whole = args[0];
        // 有捕获组就用捕获组（标记本身被丢掉）；没有就用整段匹配
        const body = (args.length > 2 && typeof args[1] === 'string') ? args[1] : whole;
        return '<details class="cd-think"' + openAttr
            + ' style="margin:.6em 0;border:1px solid rgba(128,140,160,.28);border-radius:.3em;background:rgba(128,140,160,.08)">'
            + '<summary class="cd-think-sum" style="cursor:pointer;padding:.35em .7em;font-size:.9em;opacity:.8">💭 思考（点击展开）</summary>'
            + '<div class="cd-think-body" style="padding:0 .8em .6em;opacity:.72;white-space:pre-wrap;word-break:break-word;font-size:.92em">' + body + '</div>'
            + '</details>';
    });
}

/** 这条文本里有没有思考块（按配置的正则判；正则坏了就算没有） */
export function hasThinkingBlock(text, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const pattern = String(cfg.thinkingPattern || '').trim();
    if (!pattern) return false;
    try {
        return new RegExp(pattern).test(String(text == null ? '' : text));
    } catch (_) {
        return false;
    }
}

/**
 * ★ 自动修复：模型输出漂移时的**有依据**补全。
 *
 * 真机见到的漂移（截图）：
 *   ① 只写了层名、漏了「名字·」   → `心理 我真的……`
 *   ② 整行完全没标签             → `沙良回到了自己的房间…` / `房间内的光线柔和而幽暗。`
 * 这两类原来都掉进 `text` 直通 → 名字列/颜色/层样式全丢，层名还会当正文露出来。
 *
 * 修复原则（对齐 AGENTS §0.3.3 的补偿写入六条）：
 *   · **有依据才修**：①的依据是「层名是模型自己写对的」；②的依据是「引号=说话」
 *   · **不猜方向**：完全没标注时**只归为旁白**（灰色、不占名字列），**绝不猜是哪个角色**
 *   · **必须可见**：修过的行带 `repaired` 标记，渲染时留记号 + hover 说明
 *   · **可关**：`autoRepair: 'off' | 'safe' | 'aggressive'`
 *
 * @returns {Array<{line:string, p:object, repaired:(string|null)}>}
 */
export function repairLines(lines, cfg = {}) {
    const c = { ...DEFAULT_CONFIG, ...cfg };
    const mode = String(c.autoRepair || 'off');
    const layers = allLayers(c);

    const parsed = (lines || []).map(l => {
        const t = String(l == null ? '' : l).trim();
        return { line: String(l == null ? '' : l), p: (t === '') ? { kind: 'blank', raw: '' } : parseLine(t, layers, !!c.lenientLayers) };
    });
    if (mode === 'off') return parsed.map(x => ({ line: x.line, p: x.p, repaired: null }));

    const aggressive = (mode === 'aggressive');
    /* ★★ 候选名字的合法性：**只有像人名的才敢用来补**（2026-10-14 真机踩到）
   真机：一行英文元数据 `- Time passed: from noon …` 被解析出了名字 `- Time passed`，
   于是 repairLines 把**10 行引号台词**全挂到了这个根本不存在的"角色"上 ✗
   （产物里真的渲染成了说话人 ✗）。原则同 §1.4：**不猜** ——
   拿不到像人名的名字就**不补**，保持原文 ✓ */
const NAME_LOOKS_OK = (n) => {
    const v = String(n == null ? '' : n).trim();
    if (!v || v.length > 12) return false;
    if (/^[-*#>\[\]{}()=+~`|:：,，.。!！?？]/.test(v)) return false;   // 列表/标题/引用/序号开头
    if (/[-*#>\[\]{}()=+~`|\\]/.test(v)) return false;               // 含结构性符号
    if (layers.indexOf(v) >= 0) return false;                            // 名字不可能就是层名
    return true;
};
const reLayerOnly = new RegExp('^(' + layerAlternation(layers) + ')\\s+(.+)$');
    const reQuote = /^[「“"『]/;

    /* 找「同一楼里最近一个被正确标注过的角色」——先往前找，找不到再往后找。
       为什么两个方向都找：截图里那段 `心理 …` 前面全是未标注行，
       但**后面**紧跟着 `沙良·动作 …`，往后找才拿得到 沙良。 */
    const before = []; let last = '';
    for (let i = 0; i < parsed.length; i++) { before[i] = last; if (parsed[i].p.kind === 'row' && NAME_LOOKS_OK(parsed[i].p.name)) last = parsed[i].p.name; }
    const after = []; let next = '';
    for (let i = parsed.length - 1; i >= 0; i--) { after[i] = next; if (parsed[i].p.kind === 'row' && NAME_LOOKS_OK(parsed[i].p.name)) next = parsed[i].p.name; }

    return parsed.map((x, i) => {
        const p = x.p;
        if (p.kind !== 'text') return { line: x.line, p, repaired: null };
        const t = String(x.line).trim();

        // ① 只写了层名 → 补最近的角色（层名本身是模型写对的，属于有依据）
        const m = t.match(reLayerOnly);
        if (m) {
            const layer = m[1];
            const body = m[2].trim();
            if (layer === '旁白') return { line: x.line, p: { kind: 'narr', body, repaired: 'layer-only' }, repaired: 'layer-only' };
            const who = before[i] || after[i];
            if (who) return { line: x.line, p: { kind: 'row', name: who, layer, text: body, repaired: 'name' }, repaired: 'name' };
        }

        // ② 纯引号开头 → 台词（引号=说话，硬依据）
        if (reQuote.test(t)) {
            const who = before[i] || after[i];
            if (who) return { line: x.line, p: { kind: 'row', name: who, layer: '台词', text: t, repaired: 'quote' }, repaired: 'quote' };
        }

        // ③ 完全没标注 → **只归为旁白**（不猜角色）；只有 aggressive 才做
        if (aggressive) {
            return { line: x.line, p: { kind: 'narr', body: t, repaired: 'bare' }, repaired: 'bare' };
        }

        return { line: x.line, p, repaired: null };
    });
}

// ---------------------------------------------------------------- 专属预设配方（CLI 与面板共用**同一份**实现）

/**
 * 原预设的作者与许可 —— **逐字照抄**自原预设自带的说明条目，不改写、不简化。
 *
 * 许可原文：「可以二改，禁止二传，拿功能要先问我，署名」
 * ⇒ 因此本项目**只分发"配方"（这段代码），不分发预设本体**；
 *   派生出的预设必须在使用者自己的机器上、由他自己那份原预设生成。
 */
export const PRESET_UPSTREAM = {
    author: '泉此方',
    license: '可以二改，禁止二传，拿功能要先问我，署名',
    source: 'Lucky Channel https://discord.gg/xXNWRDhZKP（仅在类脑社区与 Lucky Channel 免费发布）',
};

/** 配方参数（差分清单就写在这里，改配方只改这一处） */
/**
 * 篇幅与节奏（用户 2026-10-14：「这个应该属于预设」）
 * ⇒ 它作为**预设里的一条提示条目**存在，由生成器写入；
 *   插件只负责把它放进预设，不参与渲染判断 ✓
 *   条目名带「可改」⇒ 你在酒馆里改了**不会被覆盖** ✓
 * ★ 不用星号（免得模型把 markdown 抄进正文 ✗）
 */
export const LENGTH_SPEC = [
    '【篇幅与节奏 · 一次生成】',
    '',
    '总目标：这一次生成要写满 10 个回合（组），约 7500–8500 中文字。',
    '★ 千万不要把这里理解成「写得越短越好」：就算你想写得紧凑，也必须把 10 个回合全部写完 ——',
    '  每组长行取区间下限（150 字左右）也可以，但回合数不能少。',
    '★ 这是本次生成的目标，请写到位；预设里其它条目写的「正文字数不小于 1000」只是最低门槛，',
    '  不是目标 —— 请以本条为准，不要写到一千多字就收尾。',
    '★ 如果情节在一组内就结束了，请接着写下一个回合（同场景的下一个动作/对话，或下一个场景），',
    '  直到写满 10 个回合；只有故事确实告一段落时才允许提前收尾。',

    '',
    '一个回合 = 一组（不绑定固定行数；长行 3 条 + 台词若干）：',
    '  ① 名字·动作   150–300 字（在这个区间里随节奏波动，别每行都一样长），写过程与细节，不是概括',
    '  ② 名字·感官   150–300 字（在这个区间里随节奏波动，别每行都一样长），写触感 / 温度 / 气味 / 声音',
    '  ③ 名字·台词   按需要来回波动：短的 10 字上下，常规 10–50 字（在场每个开口的人都要有一句）',
    '  ④ 名字·台词   分量足的可以到 100 字左右 —— 关键是别每句一样长',
    '  ⑤ 名字·心理   150–300 字（在这个区间里随节奏波动，别每行都一样长），写犹豫 / 欲望 / 算计',
    '',
    '★ 台词行数 = 在场【开口】的人数（不是死板的 2 句）：',
    '  · 2 人 ⇒ 2 句（一组 5 行）· 3 人 ⇒ 3 句（6 行）· 5 人 ⇒ 5 句（8 行）',
    '  · 重要角色可以多说一句；没开口的人不给台词行',
    '  · 没开口的人的反应用「旁白」或别人的「动作/感官」交代',
    '  · 旁白需要时另起一行，不计入上面那 3 条长行',

    '★ 组数随人数下调（总量仍控制在 7500–8500 字）：',
    '  · 2 人 ⇒ 10 组 ｜ 3 人 ⇒ 8 组 ｜ 5 人以上 ⇒ 6–7 组',
    '  · 人多时不要为了凑满组数把每组写短 —— 宁可少一组',
    '  · 节奏按比例：约七成组是重场（长行与台词都写满）',
    '  · 约三成组是过渡（2–3 行：一两句台词 + 一条短心理）',
    '  · 要有起伏，不要每组都写满',
    '',
    '写完 10 个回合后自然收尾即可，不要为了凑字而硬写。',
    '如果你发现自己开始漏写「名字·层」标签，就在当前这一组写完时收住，不要再往下写 ——',
    '宁可少写一组，也不要输出没有标签的散文（散文不会被识别成行，排版会崩）。',
].join('\n');

/**
 * 把版本号盖在条目内容顶部（用户要求「加版本号」⇒ 打开预设就能看到是哪版生成的 ✓）
 * 只用「」不用星号 ✓（条目不许出现 * ⇒ 免得模型抄进正文 ✗）
 */
export function stampSpec(text) {
    return '（分镜对话 v' + VERSION + ' 生成）' + String.fromCharCode(10) + String(text == null ? '' : text);
}

export const PRESET_RECIPE = {
    promptName: '【分镜】正文行格式',
    noteName: '📋分镜派生说明（勿启用）',
    lengthName: '【分镜】篇幅与节奏（可改）',
    dbl50Name: '👤对白量：一半（50%）',
    dbl50Text: '{{setvar::dbl::，对白与描写大致各半，正文中的文字应由对白提供50％左右}}',
    /* ★ 适配（用户要求「专属预设对插件进行适配」）：
       格式说明插到 prompt_order 的**最末尾** —— 越贴近输出，模型遵循率越高 ✓
       （原来插在第 143 位，被前后一堆条目夹着，权重被稀释 ✗）
       -1 = 追加到末尾 */
    orderAt: -1,
    thinkingDepth: 20,
    thinkingRe: /思维链/,
    toggles: [
        /* ★ 人称族（用户 2026-10-14：「感觉用不上」）—— 这四条只设「旁白视角」变量 rc，
           而我们的格式说明**已经定死**旁白 = 第三人称 ⇒ 它们是重复的 ⇒ 全部关掉 ✓ */
        ['👤人称-第三人称', false], ['👤人称-第二人称', false],
        ['👤人称-User第一人称', false], ['👤人称-Char第一人称', false],
        ['🚢文风-顺眼舒服', false],
        /* ★ 对白量：只留「一半（50%）」开着（用户 2026-10-14 定的）。
           为什么必须写进来：生成器以**原版预设**为底重建 ⇒ 不纳入这里的开关会被还原成原版状态 ✗
           （实测踩到：切好的 50% 被一次生成器运行还原成「中」✗） */
        ['👤对白量：少', false], ['👤对白量：中', false], ['👤对白量：多', false],
        ['👤对白量：100%', false], ['👤对白量：一半（50%）', true],
    ],
};

/** 派生说明的正文（人可读；做成**停用**条目，只留痕不进提示词） */
export function presetNoteText(opts = {}) {
    const R = PRESET_RECIPE;
    return [
        '{{//',
        '【分镜派生说明】这份预设是从原版派生出来的**本地副本**，不是原作者的发布版。',
        '',
        '原预设作者：' + PRESET_UPSTREAM.author,
        '原预设许可：' + PRESET_UPSTREAM.license,
        '原预设来源：' + PRESET_UPSTREAM.source,
        '派生自：' + (opts.srcName || '(未记录)') + (opts.srcHash ? '（sha256 ' + String(opts.srcHash).slice(0, 16) + '…）' : ''),
        '',
        '派生改动（由「分镜对话」扩展 / scripts/cine-preset.mjs 生成，可重放）：',
        '  1. 新增提示条目「' + R.promptName + '」并启用（教模型按 \`名字·层 内容\` 写）',
        '  2. ' + R.toggles.map(t => t[0] + ' ' + (t[1] ? '开' : '关')).join(' / '),
        '  3. 思维链美化正则的最大深度 → ' + R.thinkingDepth + '（原预设为 2，往上翻的楼思考会裸露）',
        '',
        '⚠️ 本条目**保持停用**，只是留个说明，不要启用。',
        '⚠️ 原预设禁止二传 —— **这个派生文件不要分发给任何人**。',
        '}}',
    ].join('\n');
}

/**
 * 把配方套用到一份原预设对象上。
 *
 * ★ 纯函数：**绝不修改传入的对象**（内部深拷贝），CLI 与浏览器面板都调它。
 * ★ 幂等：重复套用只会报告「已是」，不会叠加条目。
 *
 * @param {object} srcObj 原预设（JSON.parse 后的对象）
 * @param {{srcName?:string, srcHash?:string, formatSpec?:string}} [opts]
 * @returns {{ok:boolean, preset:object, changes:string[], stats:object}}
 */
export function applyPresetRecipe(srcObj, opts = {}) {
    const R = PRESET_RECIPE;
    if (!srcObj || typeof srcObj !== 'object') return { ok: false, preset: null, changes: ['传入的不是一个预设对象'], stats: {} };

    const out = JSON.parse(JSON.stringify(srcObj));   // ← 纯函数保证
    const changes = [];

    const prompts = out.prompts = Array.isArray(out.prompts) ? out.prompts : [];
    if (!Array.isArray(out.prompt_order) || !out.prompt_order.length) out.prompt_order = [{ character_id: 100000, order: [] }];
    const order = out.prompt_order[0].order = Array.isArray(out.prompt_order[0].order) ? out.prompt_order[0].order : [];
    const stats = {
        promptsFrom: Array.isArray(srcObj.prompts) ? srcObj.prompts.length : 0,
        orderFrom: (((srcObj.prompt_order || [])[0] || {}).order || []).length,
    };

    // ① 格式说明条目
    let p = prompts.find(x => String(x.name || '') === R.promptName);
    if (!p) {
        p = {
            identifier: 'cine-dialogue-format',
            name: R.promptName,
            system_prompt: true,
            role: 'system',
            content: opts.formatSpec || FORMAT_SPEC,
            injection_position: 0,
            injection_depth: 4,
        };
        prompts.push(p);
        changes.push('新增提示条目「' + R.promptName + '」');
    } else {
        /* ★ 只同步**我们自己创建的那一条**（identifier === 'cine-dialogue-format'）。
           别的条目、以及用户自建的条目，一律一个字不动。
           为什么要同步：说明文本会随版本演进（0.8.3 就补了「第三人称外部描写归旁白」），
           若永远「保持不动」，老预设就永远拿不到新规则。 */
        /* ★ 识别「我们那条」不能只看 identifier：
           早期会话里创建的条目用的是随机 UUID（首行是【分镜行格式 · 必须严格遵守】），
           只认 cine-dialogue-format 会**认不出它**，新规则就永远进不去（0.8.3 实测踩到）。
           所以：identifier 命中，或「同名 + 正文带我们的标志串」都算我们的。 */
        const OURS_RE = /【(正文行格式|分镜行格式)[^\n]*必须严格遵守/;
        const byId = String(p.identifier || '') === 'cine-dialogue-format';
        const byMark = String(p.name || '') === R.promptName && OURS_RE.test(String(p.content || ''));
        const mine = byId || byMark;
        const want = stampSpec(opts.formatSpec || FORMAT_SPEC);
        if (mine && String(p.content || '') !== want) {
            p.content = want;
            changes.push('更新提示条目「' + R.promptName + '」（说明文本有更新' + (byId ? '' : '，按内容特征识别为旧版') + '）');
        } else if (mine) {
            changes.push('提示条目「' + R.promptName + '」已是最新');
        } else {
            changes.push('提示条目「' + R.promptName + '」已存在（**不是本插件创建的** → 内容一个字不动）');
        }
    }
    let entry = order.find(o => String(o.identifier) === String(p.identifier));
    if (!entry) {
        entry = { identifier: p.identifier, enabled: true };
        const at = (Number(R.orderAt) < 0) ? order.length : Math.min(Number(R.orderAt), order.length);
    order.splice(at, 0, entry);
        changes.push('插进 prompt_order 第 ' + at + ' 位（末尾）并启用');
    } else if (entry.enabled !== true) {
        entry.enabled = true;
        changes.push('prompt_order 里改为启用');
    } else {
        changes.push('prompt_order 已启用');
    }

    /* ★★ 适配（用户要求「专属预设对插件进行适配」）：
       orderAt < 0 时，把我们那条挪到**所有启用项之后**（最贴近输出 ⇒ 模型遵循率最高）。
       已存在的条目也要挪 —— 否则老预设永远停在原来的位置 ✗ */
    if (Number(R.orderAt) < 0) {
        const i = order.findIndex(o => String(o.identifier) === String(p.identifier));
        /* 已经紧跟在「其它启用项」之后 ⇒ 不用再挪（保证幂等：第二次跑不重复报告 ✗） */
        let lastOther = -1;
        for (let k = order.length - 1; k >= 0; k--) {
            if (order[k].enabled && String(order[k].identifier) !== String(p.identifier)) { lastOther = k; break; }
        }
        if (i >= 0 && i !== lastOther + 1) {
            const moved = order.splice(i, 1)[0];
            moved.enabled = true;
            let lastOn = order.length - 1;
            for (let k = order.length - 1; k >= 0; k--) { if (order[k].enabled) { lastOn = k; break; } }
            order.splice(lastOn + 1, 0, moved);
            changes.push('把「' + R.promptName + '」挪到所有启用项之后（最贴近输出）');
        }
    }

    /* ④ 篇幅与节奏（用户：「这个应该属于预设」）—— **只创建一次，绝不覆盖**：
       你在酒馆里改了组数/字数，下次跑生成器不会把你的改动冲掉 ✓ */
    try {
        const lp = prompts.find(x => String(x.name || '') === R.lengthName);
        if (!lp) {
            const nl = {
                identifier: 'cine-dialogue-length',
                name: R.lengthName,
                system_prompt: false,
                role: 'system',
                content: stampSpec(opts.lengthSpec || LENGTH_SPEC),
                injection_position: 0,
                injection_depth: 4,
                injection_order: 100,
            };
            prompts.push(nl);
            order.push({ identifier: nl.identifier, enabled: true });
            changes.push('新增提示条目「' + R.lengthName + '」并启用（放在 order 最末尾）');
        } else if (String(lp.content || '').indexOf('~10 字') >= 0
                || String(lp.content || '').indexOf('10–20 字') >= 0
                || String(lp.content || '').indexOf('按需要来回波动') >= 0) {
            /* 内容还是我们写的 v1（台词 ~10 字）⇒ 更新为 v2（10–20 字）；
               一旦你改过（不含这个标记）⇒ 一个字都不动 ✗ */
            lp.content = stampSpec(opts.lengthSpec || LENGTH_SPEC);
            changes.push('更新提示条目「' + R.lengthName + '」（台词改为按需要波动）');
        } else {
            changes.push('提示条目「' + R.lengthName + '」已被你改过（**不覆盖** ✓）');
        }
    } catch (e) { changes.push('篇幅条目处理失败：' + e.message); }

    /* ★★ 字段形态对齐（真机踩到）：酒馆原生条目都带 marker / forbid_overrides / enabled …，
       我们只写最少的字段 ⇒ **列表里不显示** ✗（用户：「就是没有」）
       ⇒ 这里把我们三条统一补成原生形态 ✓ */
    try {
        const SHAPE = {
            system_prompt: false, role: 'system',
            injection_position: 0, injection_depth: 4, injection_order: 100,
            marker: false, forbid_overrides: false, enabled: true,
        };
        const oursNames = [R.promptName, R.lengthName, R.dbl50Name];
        for (const nm of oursNames) {
            const p = prompts.find(x => String(x.name || '') === nm);
            if (!p) continue;
            let added = 0;
            for (const k of Object.keys(SHAPE)) { if (p[k] === undefined) { p[k] = SHAPE[k]; added++; } }
            if (added) changes.push('补全「' + nm + '」的字段形态（' + added + ' 个）');
        }

        /* 50% 那条：没有就创建（只创建一次；已存在**不覆盖内容** ⇒ 你可以自己改 ✓） */
        let p50 = prompts.find(x => String(x.name || '') === R.dbl50Name);
        if (!p50) {
            p50 = Object.assign({ identifier: 'cine-dialogue-dbl-50', name: R.dbl50Name, content: opts.dbl50Text || R.dbl50Text }, SHAPE);
            prompts.push(p50);
            order.push({ identifier: p50.identifier, enabled: false });
            changes.push('新增条目「' + R.dbl50Name + '」（默认关闭，和原生那三条并列）');
        } else {
            changes.push('条目「' + R.dbl50Name + '」已存在（内容不动 ✓）');
        }
    } catch (e) { changes.push('字段形态对齐失败：' + e.message); }

    // ②③ 两处开关
    for (const [name, want] of R.toggles) {
        const pr = prompts.find(x => String(x.name || '') === name);
        if (!pr) { changes.push('⚠ 找不到条目「' + name + '」→ 跳过'); continue; }
        const e = order.find(o => String(o.identifier) === String(pr.identifier));
        if (!e) { changes.push('⚠ 「' + name + '」不在 prompt_order 里 → 跳过'); continue; }
        if (e.enabled !== want) { changes.push('「' + name + '」 ' + e.enabled + ' → ' + want); e.enabled = want; }
        else changes.push('「' + name + '」 已是 ' + want);
    }

    // ④ 思维链正则的深度（只动**开着的**那条）
    const scripts = ((out.extensions || {}).regex_scripts) || [];
    let touched = 0;
    for (const sc of scripts) {
        const nm = String(sc.scriptName || '');
        if (!R.thinkingRe.test(nm)) continue;
        if (sc.disabled) { changes.push('思维链正则「' + nm + '」是关的 → 跳过'); continue; }
        if (sc.maxDepth !== R.thinkingDepth) {
            changes.push('思维链正则「' + nm + '」 maxDepth ' + sc.maxDepth + ' → ' + R.thinkingDepth);
            sc.maxDepth = R.thinkingDepth;
            touched++;
        } else {
            changes.push('思维链正则「' + nm + '」 maxDepth 已是 ' + R.thinkingDepth);
        }
    }
    if (!touched && !changes.some(c => c.indexOf('maxDepth') >= 0)) changes.push('⚠ 没找到开启中的思维链正则（结构可能变了）');

    // ⑤ 出处 + 许可（署名）
    out.extensions = out.extensions || {};
    out.extensions.cine_dialogue = {
        kind: 'derived-preset',
        derivedFrom: { file: opts.srcName || '', sha256: opts.srcHash || '' },
        upstream: { author: PRESET_UPSTREAM.author, license: PRESET_UPSTREAM.license, source: PRESET_UPSTREAM.source },
        generator: 'cine-dialogue（扩展面板 / scripts/cine-preset.mjs，同一份配方）',
        note: '本地派生副本：原预设许可为「' + PRESET_UPSTREAM.license + '」，**本文件不得二传/分发**。',
        changes: [
            '新增提示条目「' + R.promptName + '」并启用',
            R.toggles.map(t => t[0] + (t[1] ? ' 开' : ' 关')).join(' / '),
            '思维链美化正则 maxDepth → ' + R.thinkingDepth,
        ],
    };
    changes.push('写入出处与许可（作者：' + PRESET_UPSTREAM.author + '）');

    // 说明条目（停用，只留痕）
    const noteText = presetNoteText({ srcName: opts.srcName, srcHash: opts.srcHash });
    let note = prompts.find(x => String(x.name || '') === R.noteName);
    if (!note) {
        note = { identifier: 'cine-dialogue-provenance', name: R.noteName, system_prompt: false, role: 'system', content: noteText };
        prompts.push(note);
        changes.push('新增（停用的）「' + R.noteName + '」条目');
    } else {
        note.content = noteText;
        changes.push('更新「' + R.noteName + '」条目');
    }
    let ne = order.find(o => String(o.identifier) === String(note.identifier));
    if (!ne) {
        ne = { identifier: note.identifier, enabled: false };
        order.push(ne);
        changes.push('说明条目挂进 prompt_order（**停用**）');
    } else if (ne.enabled !== false) {
        ne.enabled = false;
        changes.push('说明条目改为停用（只留痕，不进提示词）');
    } else {
        changes.push('说明条目已是停用状态');
    }

    stats.promptsTo = prompts.length;
    stats.orderTo = order.length;
    stats.enabledTo = order.filter(o => o.enabled).length;
    return { ok: true, preset: out, changes, stats };
}

/** 统计（面板/排障用） */
export function stats() {
    return { version: VERSION, layers: LAYERS.slice(), palette: PALETTE.slice() };
}
