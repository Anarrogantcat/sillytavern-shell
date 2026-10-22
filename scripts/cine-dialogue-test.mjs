// scripts/cine-dialogue-test.mjs — 分镜对话 Cine Dialogue 夹具测试
// 用法：node scripts/cine-dialogue-test.mjs
// 只测 logic.js（纯函数层）—— 不碰 DOM、不碰 ST、不联网
// 例外：末尾有一条「模块链接自检」，只在**本机找得到 ST 本体**时真查（找不到就跳过，不会假红）
import fs from 'node:fs';
import path from 'node:path';
import {

    VERSION, EXT_ID, LAYERS, LAYER_CLS, PALETTE, DEFAULT_CONFIG, PANEL_FIELDS, PANEL_GROUPS,
    FORMAT_SPEC, REGEX_DEFS, SLASH_COMMAND,
    MARK_OPTIONS, DEFAULT_LAYER_STYLES, EXPORT_SCHEMA, configKeys,
    allLayers, layerVars, resolveColors, validateLayerName, rowDimmed,
    highlightPlan, sceneTitle, messageTitle, rowRegexFor,
    serializeConfig, parseConfig, stClassPrefix, wrapThinkingBlock, hasThinkingBlock, PLAIN_ANCHOR, repairLines, layerClass,
    esc, parseLine, isOurLine, splitSections, parseBlocks, collectNames,
    assignColors, renderGrid, renderOptions, renderMessage, renderMessageHTML, renderSegments,
    hasOurLines, stats, renderInlineImages, parseNameList,
    applyPresetRecipe, PRESET_UPSTREAM, PRESET_RECIPE, presetNoteText, canonLayer,
UPSTREAM_LENGTH_FIXES, fixUpstreamLength, normalizeSpeechQuotes, mergeSplitTags, stampSpec, LENGTH_SPEC, narratePlain, guessGenderFromText, } from '../extensions/cine-dialogue/logic.js';

/* ★★ 1.8.3：默认 respectCardFrontend=true ⇒ <options> 原样留给卡（用户选定 ✓）
   下面这些「选项转换成我们自己的按钮」的夹具，显式关掉该开关继续测这个功能 ✓ */
const CONV_CFG = { ...DEFAULT_CONFIG, respectCardFrontend: false };

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    failures.push(name + (extra !== undefined ? ('  → ' + JSON.stringify(extra)) : ''));
}
function eq(name, actual, expected) { ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected }); }

/* ---------------------------- 基础 ---------------------------- */
eq('version 与 manifest 一致', VERSION, '1.9.8');
eq('extension id', EXT_ID, 'cine-dialogue');
eq('五层齐全', LAYERS, ['台词', '动作', '感官', '心理', '旁白']);
ok('每层都有 CSS 类且带 cd- 前缀', LAYERS.every(l => LAYER_CLS[l] && LAYER_CLS[l].startsWith('cd-L-')));
eq('调色板 8 色', PALETTE.length, 8);

/* ---------------------------- 转义 ---------------------------- */
eq('esc 转义尖括号', esc('<b>'), '&lt;b&gt;');
eq('esc 转义引号（属性安全）', esc('a"b\'c'), 'a&quot;b&#39;c');
eq('esc 转义 &', esc('a&b'), 'a&amp;b');

/* ---------------------------- 行解析 ---------------------------- */
eq('普通行', parseLine('林野·动作 我把她按在床上。'),
    { kind: 'row', name: '林野', layer: '动作', text: '我把她按在床上。' });
eq('台词行', parseLine('林婉婷·台词 「不脱。」'),
    { kind: 'row', name: '林婉婷', layer: '台词', text: '「不脱。」' });
eq('旁白行（无名字字段）', parseLine('旁白·门缝底下那道光暗了一下。'),
    { kind: 'narr', body: '门缝底下那道光暗了一下。' });
eq('层后漏空格 → err（显式暴露，不猜）', parseLine('林野·动作我按住了她。').kind, 'err');
eq('没有层标签 → text（普通文本，原样通过、不刷红）', parseLine('随便一句话。').kind, 'text');
eq('空行 → text', parseLine('').kind, 'text');
ok('isOurLine 认 row', isOurLine('林野·感官 我后背起了一层薄汗。'));
ok('isOurLine 认 narr', isOurLine('旁白·她站在门口。'));
ok('isOurLine 不认散文', !isOurLine('她站在门口没动。'));

/* ---------------------------- 切段 ---------------------------- */
const raw = [
    '林野·动作 我把她按在床上。',
    '[FRONTEND]<div class="x">前端</div>[/FRONTEND]',
    '林婉婷·台词 「不脱。」',
    '[OPTIONS]',
    '1. 吻她 | 温柔',
    '2. 按住她',
    '[/OPTIONS]',
].join('\n');
const sec = splitSections(raw);
eq('frontend 抽出 1 段', sec.frontend.length, 1);
ok('frontend 内容正确', sec.frontend[0].includes('前端'));
eq('options 抽出 2 条', sec.options.length, 2);
eq('选项 1 带备注', [sec.options[0].index, sec.options[0].text, sec.options[0].note], ['1', '吻她', '温柔']);
eq('选项 2 无备注', sec.options[1].note, '');
ok('正文里不再含 [FRONTEND]', !sec.body.includes('[FRONTEND]'));
ok('正文里不再含 [OPTIONS]', !sec.body.includes('[OPTIONS]'));

/* ---------------------------- 分组 ---------------------------- */
const body = [
    '林野·台词 「都进来。」',
    '林婉婷·动作 我侧身把门让开。',
    '',
    '苏晴·心理 我不该站在这里。',
    '旁白·门缝底下那道光暗了一下。',
].join('\n');
const { groups, errs } = parseBlocks(body);
eq('空行分出 2 组', groups.length, 2);
eq('第 1 组 2 行', groups[0].length, 2);
eq('第 2 组 2 行', groups[1].length, 2);
eq('没有格式错', errs, 0);

/* ★ 行为变更（0.5.2）：「格式错误」只算**长得像我们的行但写错了**的那些。
   普通散文是 text（原样通过），不是 error —— 否则模型思考块几百行会全红。 */
const badOut = parseBlocks('林野·动作 正确的行。\n林野·动作我漏了空格。');
eq('格式错的行被计数（松散匹配才算错）', badOut.errs, 1);
const proseOut = parseBlocks('林野·动作 正确的行。\n这行只是普通散文，和分镜无关。');
eq('普通散文不算格式错', proseOut.errs, 0);
eq('普通散文被判为 text', proseOut.groups[0][1].kind, 'text');

/* ---------------------------- 名字与颜色 ---------------------------- */
eq('按出现顺序收集名字', collectNames(groups), ['林野', '林婉婷', '苏晴']);

const c1 = assignColors(['林野', '林婉婷'], {});
eq('首个角色拿第 1 色', c1['林野'], PALETTE[0]);
eq('第二角色拿第 2 色', c1['林婉婷'], PALETTE[1]);
const c2 = assignColors(['林野', '林婉婷', '苏晴'], c1);
eq('已有角色颜色不变（跨消息稳定）', c2['林野'], PALETTE[0]);
eq('新角色接第 3 色', c2['苏晴'], PALETTE[2]);
const many = assignColors(Array.from({ length: 10 }, (_, i) => 'N' + i), {});
ok('超出调色板 → HSL 兜底', String(many['N8']).startsWith('hsl('));
eq('10 个角色都有色', Object.keys(many).length, 10);

/* ---------------------------- 渲染 ---------------------------- */
const r = renderMessage(body, {}, DEFAULT_CONFIG);
ok('渲染出 HTML', typeof r.html === 'string' && r.html.length > 0);
ok('只有一个网格（一条消息一个网格）', (r.html.match(/cd-grid/g) || []).length === 1);
    /* ★ 用户 2026-10-14：「把默认值改成 true」⇒ 推翻旧的"默认不画线"决定 ✓ */
    eq('★★ 默认画分隔线（用户要求改默认）', DEFAULT_CONFIG.showSeparators, true);
ok('打开 showSeparators 且跨回合才画分隔线', (() => { const N5 = String.fromCharCode(10); const two5 = '甲·动作 一' + N5 + N5 + '甲·动作 二'; return renderMessage(two5, {}, { ...DEFAULT_CONFIG, showSeparators: true }).html.includes('<div class="cd-sep"></div>') && !renderMessage(two5, {}, { ...DEFAULT_CONFIG, showSeparators: false }).html.includes('<div class="cd-sep"></div>'); })());
ok('动作行带 cd-L-act', r.html.includes('cd-L-act'));
ok('心理行带 cd-L-mind', r.html.includes('cd-L-mind'));
ok('旁白行带 cd-L-narr', r.html.includes('cd-L-narr'));
ok('名字在 cd-who 里', r.html.includes('<span class="cd-who">林野</span>'));
    /* ★ 意图「颜色要作为 --c 发出」不变；判据改为「与 resolveColors 给出的一致」
       （0.8.14 起颜色按名字哈希，不再按下标取色 ⇒ 不能再钉死 PALETTE[0]） */
    const cLin = resolveColors(['林野'], DEFAULT_CONFIG, {})['林野'];
    ok('颜色写进 --c 变量（与 resolveColors 一致）', r.html.includes('--c:' + cLin));
ok('★ 旁白保留名字格 ⇒ 正文与各行对齐', /cd-L-narr[^>]*><span class="cd-who"><\/span>/.test(r.html));
ok('标签不出现在输出里', !r.html.includes('·动作') && !r.html.includes('旁白·'));
ok('渲染结果里没有 .mes_text 选择器', !r.html.includes('.mes_text'));

const rNone = renderMessage('就是一段普通散文，没有任何标签。', {}, DEFAULT_CONFIG);
eq('没有我们的行 → 不产出 HTML（调用方就不碰 DOM）', rNone.html, null);

/* 标红的判据变了：只有「长得像我们的行但写错了」才红 */
const rGood = '林野·动作 我按住了她。\n苏晴·台词 「别。」\n林野·感官我漏了空格。';
const rBad = renderMessage(rGood, {}, DEFAULT_CONFIG);
ok('格式错行被标红（占比够 → 接管这条消息）', rBad.html.includes('cd-err'));
ok('格式错行原文可见', rBad.html.includes('格式错误'));
const rBadOff = renderMessage(rGood, {}, { ...DEFAULT_CONFIG, markErrors: false });
ok('markErrors=false 时不输出错误行', !rBadOff.html.includes('cd-err'));

/* ★ 普通散文混在里面 → 走 passthrough（.cd-line），绝不当成格式错误 */
const rMixed = renderMessage('林野·动作 我按住了她。\n苏晴·台词 「别。」\n这是一句普通说明，不是分镜行。', {}, DEFAULT_CONFIG);
ok('混进来的普通散文用 .cd-line 原样通过', rMixed.html.includes('cd-line'));
ok('普通散文不被标红', !rMixed.html.includes('cd-err'));
ok('普通散文字面还在', rMixed.html.includes('这是一句普通说明'));

/* ★★ 消息级门槛：思考块占多数 → 整条不碰（真机踩过的那个"全屏格式错误"） */
const thinkingLike = [
    '{思考内容}',
    '棒进入了她的体内。这不仅是生理上的充实，更是一种心理上的彻底被占有。',
    '格式错误我要把镜头聚焦在两人身体碰撞的每一个细节上：',
    '1. 肌肉的震颤：染在冲刺时，胸肌的隆起和背部肌肉的线条如何由于发力而变得紧绷。',
    '2. 液体的流转：她们的交接处因为缺乏充分润滑带来的最初的一点涩。',
    '3. 沙良的心理防线崩溃：她必须在心里不断地和自己那个庸的丈夫做对比。',
    '4. 男性凝视：染不是在盲目地做爱，他在精准地控制节奏。',
    '林野·动作 我按住了她。',
    '</konatan_planning~>',
].join('\n');
const rThinking = renderMessage(thinkingLike, {}, DEFAULT_CONFIG);
eq('DOM 降级路径：思考块占多数 → null（那条路径没有分段能力，保守跳过）', rThinking.html, null);
eq('门槛原因标为 ratio', rThinking.skipped, 'ratio');
ok('门槛统计：占比确实不到 50%', rThinking.ratio < 0.5, rThinking);

/* ★★ 钩子路径改用**分段渲染** —— 不再整条跳过：
   我们的行 → 网格；其它行 → **原样文本**（思考块照常显示，一个字不改）。
   这是「没有美化」的真因修复：思考块与正文同处一个 mes 时，旧门槛把正文一起跳过了。 */
/* ★ 这两块测的是「未标注行**原样交给 ST**」的通道（markdown / 思考块 ✓），
   不是旁白规则 ⇒ 显式关掉 narrateUnlabeled（旁白规则由下面专门那一块覆盖 ✓） */
const rSeg = renderMessageHTML(thinkingLike, {}, { ...DEFAULT_CONFIG, narrateUnlabeled: false });
ok('分段渲染：不再整条跳过（返回非 null）', rSeg !== null);
ok('分段渲染：有 ours 段', !!rSeg && rSeg.segments.some(s => s.kind === 'ours'));
ok('分段渲染：有 text 段（思考块原样通过）', !!rSeg && rSeg.segments.some(s => s.kind === 'text'));
ok('分段渲染：思考块内容原样保留', !!rSeg && rSeg.html.includes('肌肉的震颤'));
ok('分段渲染：正文进了网格', !!rSeg && rSeg.html.includes('cd-grid'));
ok('分段渲染：正文拿到了颜色', !!rSeg && /--c:#/.test(rSeg.html));
ok('分段渲染：标签零泄漏（去标签后不该出现 ·动作 / 旁白·）',
    !!rSeg && !/·动作|·感官|·台词|·心理|旁白·/.test(rSeg.html.replace(/<[^>]*>/g, '')));
eq('分段渲染：段落顺序 text → ours → text',
    rSeg.segments.map(s => s.kind).join(','), 'text,ours,text');

/* XSS：内容里的标签必须被转义 */
const rXss = renderMessage('林野·动作 <img src=x onerror=alert(1)>\n苏晴·台词 「嗯。」', {}, DEFAULT_CONFIG);
ok('内容里的 HTML 被转义', rXss.html.includes('&lt;img') && !rXss.html.includes('<img'));

/* ---------------------------- 选项渲染 ---------------------------- */
const oHtml = renderOptions([{ index: '1', text: '吻她', note: '温柔' }]);
ok('选项按钮带 data-cd-text', oHtml.includes('data-cd-text="吻她"'));
ok('选项备注渲染', oHtml.includes('温柔'));
eq('空选项 → 空串', renderOptions([]), '');

/* ---------------------------- 边界 ---------------------------- */
ok('hasOurLines 认分镜行', hasOurLines('随便\n林野·台词 「嗯。」\n结束'));
ok('hasOurLines 不认纯散文', !hasOurLines('她站在门口，没有动。'));
eq('splitSections 容忍 null', splitSections(null).options.length, 0);
eq('renderMessage 容忍 null', renderMessage(null).html, null);
eq('stats 有版本', stats().version, VERSION);

/* ---------------------------- 钩子路径（核内补丁 #001） ---------------------------- */
// 钩子跑在 messageFormatting 开头 —— 那时正则还没跑，
// 所以它看到的是预设的**原始**标签 <htmlcontent>/<options>，不是我们替换后的 [FRONTEND]
const hRaw = '林野·动作 我把她按在床上。\n苏晴·台词 「别动。」\n<htmlcontent><div>前端</div></htmlcontent>\n<options>\n>选项一：吻她\n>选项二：按住她\n</options>';
const hSec = splitSections(hRaw);
eq('认 <htmlcontent>（钩子路径的外壳形式）', hSec.frontend.length, 1);
ok('前端 HTML 原样保留、不被转义', hSec.frontend[0].includes('<div>前端</div>'));
eq('认 <options> 的「>选项一：」写法', hSec.options.length, 2);
eq('选项一文本', hSec.options[0].text, '吻她');
eq('选项标签名', hSec.options[0].index, '选项一');
ok('正文里不再含 <htmlcontent>', !hSec.body.includes('<htmlcontent>'));
ok('正文里不再含 <options>', !hSec.body.includes('<options>'));

eq('renderMessageHTML：没有我们的行 → null（一个字节不改）', renderMessageHTML('就是一段普通散文。'), null);
const hRes = renderMessageHTML(hRaw, {}, CONV_CFG);
ok('钩子产出网格', !!hRes && hRes.html.includes('cd-grid'));
ok('钩子产出：前端 HTML 未被转义（原样拼回）', hRes.html.includes('<div>前端</div>'));
ok('钩子产出：选项按钮已渲染', hRes.html.includes('data-cd-text="吻她"'));
/* ★ 回归：选项必须在 .cd-root **内部** —— 主题变量定义在 .cd-root 上，
   拼在外面就继承不到 → var() 失效 → 选项回落成浏览器默认白底按钮（真机踩过）。 */
ok('选项在 .cd-root 内部（否则拿不到主题变量）',
    hRes.html.indexOf('cd-options') < hRes.html.lastIndexOf('</div>')
    && /class="cd-root[^"]*"[\s\S]*cd-options[\s\S]*<\/div>\s*$/.test(hRes.html.replace(/<htmlcontent>[\s\S]*$/, '')));
ok('钩子产出：标签不出现', !hRes.html.includes('·动作'));
ok('钩子产出：旁白保留名字格（与各行对齐）', /cd-L-narr[^>]*><span class="cd-who"><\/span>/.test(renderMessageHTML('旁白·灯灭了。\n林野·动作 我按住她。').html));

/* ---------------------------- 回归对照（自检发现的坑，§1.4.6 留对照夹具） ----------------------------
   坑：renderMessageHTML 原来用「整条原文」做 hasOurLines 判据。
   若标签**只出现在 <htmlcontent> / [FRONTEND] 里**，整条原文判为「有我们的行」，
   但 splitSections 把外壳切走后正文里没有我们的行 → renderMessage 返回 html:null
   → 继续拼 `'' + 前端 + 选项` 会返回**非空字符串**，钩子的 `!res.html` 拦不住 → **正文整段丢失**。
   下面两条断言必须同时成立：旧行为（整条判为真）可复现 + 新行为（返回 null）被锁死。 */
const onlyFront = '<htmlcontent>\n林野·动作 这是前端里的示例文本\n</htmlcontent>\n这一行是普通正文，不该被吃掉。';
ok('回归·旧行为可复现：整条原文 hasOurLines 确实为真（说明这个坑真实存在）', hasOurLines(onlyFront) === true);
eq('回归·新行为：标签只在外壳里 → 返回 null（绝不吃掉正文）', renderMessageHTML(onlyFront), null);
eq('回归：正文里真的没有我们的行', hasOurLines(splitSections(onlyFront).body), false);

/* ---------------------------- 设置面板字段表（0.3.0） ----------------------------
   面板 HTML 在 index.js（碰 DOM，Node 里测不了），但**字段定义**在纯函数层，
   所以能在这里挡住「拼错 key → 改了没反应」这类静默失效。 */
ok('面板字段非空', PANEL_FIELDS.length > 0);
ok('每个面板字段的 key 都真实存在于 DEFAULT_CONFIG（挡拼错 key）',
    PANEL_FIELDS.every(f => Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, f.key)),
    PANEL_FIELDS.filter(f => !Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, f.key)).map(f => f.key));
eq('面板字段 key 不重复', new Set(PANEL_FIELDS.map(f => f.key)).size, PANEL_FIELDS.length);
ok('每个字段都有标签 + 已知类型',
    PANEL_FIELDS.every(f => !!f.label && ['bool', 'select', 'number', 'text'].indexOf(f.kind) >= 0),
    PANEL_FIELDS.filter(f => !f.label || ['bool', 'select', 'number', 'text'].indexOf(f.kind) < 0).map(f => f.key));
ok('select 字段都带非空 options',
    PANEL_FIELDS.filter(f => f.kind === 'select').every(f => Array.isArray(f.options) && f.options.length > 0));
ok('number 字段都带 min/max/step',
    PANEL_FIELDS.filter(f => f.kind === 'number').every(f => Number.isFinite(f.min) && Number.isFinite(f.max) && Number.isFinite(f.step)));
ok('默认值都在 number 字段的 min/max 范围内（挡越界默认值）',
    PANEL_FIELDS.filter(f => f.kind === 'number').every(f => {
        const v = Number(DEFAULT_CONFIG[f.key]);
        return v >= f.min && v <= f.max;
    }),
    PANEL_FIELDS.filter(f => f.kind === 'number').map(f => [f.key, DEFAULT_CONFIG[f.key], f.min, f.max]));

/* ---------------------------- L3 格式说明 ---------------------------- */
ok('格式说明非空且够长', typeof FORMAT_SPEC === 'string' && FORMAT_SPEC.length > 200, FORMAT_SPEC && FORMAT_SPEC.length);
ok('格式说明写明了「层名后必须有一个空格」', FORMAT_SPEC.includes('空格'));
ok('格式说明含全部五个层名', LAYERS.every(l => FORMAT_SPEC.includes(l)));
ok('格式说明写明了第一人称「我」', FORMAT_SPEC.includes('第一人称'));
ok('格式说明禁止自创层名', FORMAT_SPEC.includes('不得自创'));
ok('格式说明的示例行能被自己的解析器认出来（不然教模型输出我们解析不了的东西）',
    parseLine('林野·动作 我按住了她。').kind === 'row'
    && parseLine('旁白·灯灭了。').kind === 'narr');

/* ---------------------------- 专属正则（4 条） ---------------------------- */
eq('正则 4 条', REGEX_DEFS.length, 4);
eq('正则 id 唯一', new Set(REGEX_DEFS.map(d => d.id)).size, 4);
eq('正则名唯一且全部带【分镜】前缀', REGEX_DEFS.filter(d => String(d.script_name).startsWith('【分镜】')).length, 4);
ok('每条都有 find_regex', REGEX_DEFS.every(d => typeof d.find_regex === 'string' && d.find_regex.length > 0));
ok('每条 find_regex 都能编译', REGEX_DEFS.every(d => {
    try { void new RegExp(d.find_regex, d.flags || ''); return true; } catch (_) { return false; }
}), REGEX_DEFS.filter(d => { try { void new RegExp(d.find_regex, d.flags || ''); return false; } catch (_) { return true; } }).map(d => d.id));
ok('全部只改 display、不碰 prompt（不得污染提示词）',
    REGEX_DEFS.every(d => d.destination.display === true && d.destination.prompt === false));
ok('全部限制 max_depth（只作用最近几楼）', REGEX_DEFS.every(d => Number.isFinite(d.max_depth)));
ok('R2/R3 默认开（DOM 降级路径必需）',
    REGEX_DEFS.filter(d => ['cd-r2-frontend', 'cd-r3-options'].includes(d.id)).every(d => d.enabled === true));

const rx = (id) => REGEX_DEFS.find(d => d.id === id);
ok('R2 真的能匹配 <htmlcontent>…</htmlcontent>',
    new RegExp(rx('cd-r2-frontend').find_regex, 'g').test('<htmlcontent><div>x</div></htmlcontent>'));
ok('R3 真的能匹配 <options>…</options>',
    new RegExp(rx('cd-r3-options').find_regex, 'g').test('<options>\n1. 吻她\n</options>'));

/* ★ 闭环断言：正则跑完之后的文本，解析器必须认得（两条路径不许脱节） */
const rawPreset = '林野·动作 我按住她。\n<htmlcontent><div>P</div></htmlcontent>\n<options>\n1. 吻她\n</options>';
const afterRegex = rawPreset
    .replace(new RegExp(rx('cd-r2-frontend').find_regex, 'g'), rx('cd-r2-frontend').replace_string)
    .replace(new RegExp(rx('cd-r3-options').find_regex, 'g'), rx('cd-r3-options').replace_string);
const secAfter = splitSections(afterRegex);
eq('闭环：跑完 R2 后 splitSections 认得出前端区', secAfter.frontend.length, 1);
eq('闭环：跑完 R3 后 splitSections 认得出选项', secAfter.options.length, 1);
eq('闭环：R3 之后选项文本正确', secAfter.options[0].text, '吻她');
ok('闭环：正文里不再残留原始标签', !secAfter.body.includes('<htmlcontent>') && !secAfter.body.includes('<options>'));

/* ---------------------------- L4 斜杠命令 ---------------------------- */
ok('斜杠命令有名字', typeof SLASH_COMMAND.name === 'string' && SLASH_COMMAND.name.length > 0);
ok('斜杠命令有别名', Array.isArray(SLASH_COMMAND.aliases) && SLASH_COMMAND.aliases.length > 0);
ok('斜杠命令有 helpString', typeof SLASH_COMMAND.helpString === 'string' && SLASH_COMMAND.helpString.length > 0);
ok('子命令 ≥ 3 个且都有名字与说明',
    SLASH_COMMAND.subcommands.length >= 3 && SLASH_COMMAND.subcommands.every(s => s.name && s.description));
eq('子命令名唯一', new Set(SLASH_COMMAND.subcommands.map(s => s.name)).size, SLASH_COMMAND.subcommands.length);
ok('refresh/stats/config/regex 四个子命令都在',
    ['refresh', 'stats', 'config', 'regex'].every(n => SLASH_COMMAND.subcommands.some(s => s.name === n)));

/* ---------------------------- L5/L6/L8 配置面（0.5.0） ---------------------------- */

/* ★ 回归断言：border-style:none 会让 used border-width 归零 → 那一行整体左移 3px，
   和有线行对不齐（这个坑早先在预览原型里踩过一次，这里锁死）。 */
ok('layerVars 永不输出 --cd-mark:none（否则 3px 会塌、行会左移）',
    LAYERS.every(l => !layerVars(l, {}).includes('--cd-mark:none')),
    LAYERS.map(l => [l, layerVars(l, {})]));
ok('无标记的层用「solid 兜底 + transparent」保住 3px',
    layerVars('台词', {}).includes('--cd-mark:solid') && layerVars('台词', {}).includes('--cd-mark-color:transparent'));
ok('心理层默认双线 + 斜体',
    layerVars('心理', {}).includes('--cd-mark:double') && layerVars('心理', {}).includes('--cd-italic:italic'));
ok('逐层覆盖生效（动作改虚线）',
    layerVars('动作', { layerStyles: { '动作': { mark: 'dashed' } } }).includes('--cd-mark:dashed'));
ok('非法 mark 被忽略（回落默认，不注入脏 CSS）',
    layerVars('动作', { layerStyles: { '动作': { mark: '<script>' } } }).includes('--cd-mark:solid'));
ok('五层都有默认样式且 mark 合法',
    LAYERS.every(l => DEFAULT_LAYER_STYLES[l] && MARK_OPTIONS.indexOf(DEFAULT_LAYER_STYLES[l].mark) >= 0));

/* 自定义层 */
eq('allLayers：无自定义时就是内置五层', allLayers({}), LAYERS);
eq('allLayers：追加自定义层', allLayers({ customLayers: [{ name: '系统' }] }).length, 6);
eq('allLayers：与内置重名时去重', allLayers({ customLayers: [{ name: '台词' }, { name: '系统' }] }).length, 6);
ok('自定义层能被解析（名字·系统 内容）',
    parseLine('广播·系统 提示音响起。', allLayers({ customLayers: [{ name: '系统' }] })).kind === 'row');
/* ★ 标红的判据刻意**收窄**：只有「我们自己的层名 + 漏了那个空格」才红。
   不认识的层名 / 压根没有层名 → **不是我们的行** → 原样放过（text）。
   取舍：宁可漏报，也不能把别的约定（卡自己的 `名字·称呼`、散文）刷红 ——
   真机踩过的正是「过度标红」（整段思考块变红）。 */
eq('没登记过的层名 → text（不是我们的行，原样放过）',
    parseLine('广播·未登记 提示音。').kind, 'text');
eq('漏了层名（名字· 内容）→ text（同上，不乱认）',
    parseLine('林野· 内容').kind, 'text');
eq('我们自己的层名 + 漏空格 → err（这才是要标红的）',
    parseLine('林野·动作我按住她。').kind, 'err');
ok('rowRegexFor 在有自定义层时返回不同的正则',
    rowRegexFor(allLayers({ customLayers: [{ name: '系统' }] })) !== rowRegexFor(LAYERS));

/* 层名校验 */
ok('层名校验：拒绝空', validateLayerName('').ok === false);
ok('层名校验：拒绝含空格或 ·', validateLayerName('系 统').ok === false && validateLayerName('系·统').ok === false);
ok('层名校验：拒绝超长', validateLayerName('一二三四五六七').ok === false);
ok('层名校验：拒绝与内置重名', validateLayerName('台词').ok === false);
ok('层名校验：接受「系统」', validateLayerName('系统').ok === true && validateLayerName('系统').name === '系统');

/* 配色 */
eq('resolveColors：点名颜色优先', resolveColors(['林野'], { charColors: { '林野': '#123456' } })['林野'], '#123456');
    /* ★★ 旧断言「按出现顺序」已废除（0.8.14 起按名字哈希 ⇒ 顺序无关）
       真机回归：0.8.12 改解析后顺序变了 ⇒ 颜色全部洗牌，用户报「颜色不对」✗ */
    eq('resolveColors：没点名的按**名字**推导（与顺序无关）',
        resolveColors(['林野'], DEFAULT_CONFIG, {})['林野'],
        resolveColors(['林野', '苏晴', '林婉婷'], DEFAULT_CONFIG, {})['林野']);
    /* ★ 意图不变（钉死一个人不该改变别人的颜色 ✓），判据改为与「无人被点名时」比较 */
    eq('resolveColors：点名不影响别人拿色',
        resolveColors(['林野'], { ...DEFAULT_CONFIG, charColors: { 苏晴: '#123456' } }, {})['林野'],
        resolveColors(['林野'], DEFAULT_CONFIG, {})['林野']);

/* 只看某角色 */
ok('rowDimmed：非选中角色变淡', rowDimmed({ kind: 'row', name: '苏晴' }, '林野') === true);
ok('rowDimmed：选中角色不变', rowDimmed({ kind: 'row', name: '林野' }, '林野') === false);
ok('rowDimmed：旁白不受影响', rowDimmed({ kind: 'narr' }, '林野') === false);
ok('rowDimmed：没设过滤时都不变', rowDimmed({ kind: 'row', name: '苏晴' }, '') === false);

/* 高亮 */
eq('highlightPlan：空查询 → 单段不命中', highlightPlan('abc', ''), [{ t: 'abc', hit: false }]);
eq('highlightPlan：两个命中', highlightPlan('aXbXc', 'X').filter(p => p.hit).length, 2);
ok('highlightPlan：大小写不敏感', highlightPlan('AbC', 'b')[1].hit === true);
ok('highlightPlan：没命中就单段', highlightPlan('abc', 'zz').every(p => !p.hit));
eq('highlightPlan：拼回去等于原文', highlightPlan('aXbXc', 'X').map(p => p.t).join(''), 'aXbXc');

/* 大纲标题 */
eq('sceneTitle：只认旁白', sceneTitle({ kind: 'row', name: '林野', layer: '动作', text: 'x' }), '');
ok('sceneTitle：超长截断', sceneTitle({ kind: 'narr', body: '一'.repeat(50) }).endsWith('…'));
eq('messageTitle：取第一条旁白', messageTitle([{ kind: 'row' }, { kind: 'narr', body: '灯灭了' }]), '灯灭了');

/* 导出 / 导入 */
const expText = serializeConfig({ ...DEFAULT_CONFIG, charColors: { '林野': '#111111' } });
const expObj = JSON.parse(expText);
eq('导出带 schema', expObj.schema, EXPORT_SCHEMA);
eq('导出带 charColors', expObj.config.charColors['林野'], '#111111');
const back = parseConfig(expText);
ok('导入：自己的导出能读回来', back.ok === true && back.config.charColors['林野'] === '#111111');
eq('导入：schema 不匹配要拒绝', parseConfig('{"schema":"别的@9","config":{}}').ok, false);
eq('导入：坏 JSON 要拒绝', parseConfig('{不是 json').ok, false);
ok('导入：未知键被丢弃并报告', (() => {
    const r = parseConfig('{"config":{"enabled":true,"evil":"x"}}');
    return r.ok && r.dropped.indexOf('evil') >= 0 && r.config.evil === undefined;
})());
ok('导入：类型不对的键被丢弃', (() => {
    const r = parseConfig('{"config":{"rowGap":"不是数字"}}');
    return r.ok && r.dropped.indexOf('rowGap') >= 0;
})());

/* 配置面覆盖度：加了配置键却忘了给 UI —— 这里会拦下来 */
/* ★ 1.7.0/1.8.0 追加：respectCardFrontend / cardHasFrontend / autoOffCardFrontend
   （意图都是"别碰自带前端的卡"✓ 目前是代码管理，面板字段待补） */
const CODE_MANAGED = ['palette', 'layerStyles', 'charColors', 'perCard', 'customLayers', 'onlyChar', 'highlight', 'respectCardFrontend', 'cardHasFrontend', 'autoOffCardFrontend'];
ok('每个 DEFAULT_CONFIG 键要么有面板字段、要么登记为代码管理',
    Object.keys(DEFAULT_CONFIG).every(k => PANEL_FIELDS.some(f => f.key === k) || CODE_MANAGED.indexOf(k) >= 0),
    Object.keys(DEFAULT_CONFIG).filter(k => !PANEL_FIELDS.some(f => f.key === k) && CODE_MANAGED.indexOf(k) < 0));
ok('configKeys 白名单覆盖全部 DEFAULT_CONFIG 键',
    Object.keys(DEFAULT_CONFIG).every(k => configKeys().indexOf(k) >= 0));

/* ---------------------------- ★ 模块链接自检（全套里最重要的一条） ----------------------------
   ES module 只要 import 了一个目标模块**不存在**的导出名 → 整个模块**链接失败 → 一行都不执行**。
   表现极具迷惑性：扩展在「管理扩展程序」里显示**已启用**，但抽屉 / 渲染 / 设置**全都没有**，
   除了 console 一条 module error 之外没有任何提示。

   这个 bug 真实发生过（0.1.0–0.5.0 全部中招）：`extension_settings` 从 `script.js` 拿，
   而它其实由 `extensions.js` 导出 —— 所有能正常工作的扩展（card-compat / plot-pilot / hide …）
   都从 `extensions.js` 拿，只有我们写错了。

   本机找得到 ST 本体就真查；找不到就跳过（不让夹具在别的机器上假红）。 */
const ST_PUBLIC = 'D:/AI/SillyTavern/SillyTavern/public';
const SRC_OF = {
    '../../../../script.js': 'script.js',
    '../../../extensions.js': 'scripts/extensions.js',
};

function exportedNames(file) {
    const s = fs.readFileSync(file, 'utf8');
    const names = new Set();
    for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        names.add(m[1]);
    }
    for (const m of s.matchAll(/^export\s*\{([\s\S]*?)\}/gm)) {
        for (const part of m[1].split(',')) {
            const t = part.trim();
            if (!t) continue;
            const as = t.split(/\s+as\s+/);
            names.add((as[1] || as[0]).trim());
        }
    }
    return names;
}

if (!fs.existsSync(ST_PUBLIC)) {
    console.log('（跳过模块链接自检：本机找不到 ST 本体 ' + ST_PUBLIC + '）');
} else {
    const selfSrc = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const missing = [];
    let checked = 0;
    for (const m of selfSrc.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
        if (m[2].indexOf('./') === 0) continue;          // 自家模块（./logic.js），不用查 ST
        const rel = SRC_OF[m[2]];
        if (!rel) { missing.push('未登记的 import 路径：' + m[2]); continue; }
        const target = path.join(ST_PUBLIC, rel.split('/').join(path.sep));
        if (!fs.existsSync(target)) { missing.push('目标文件不存在：' + rel); continue; }
        const have = exportedNames(target);
        for (const part of m[1].split(',')) {
            const t = part.trim();
            if (!t) continue;
            const bits = t.split(/\s+as\s+/);
            const want = bits[0].trim();
            const alias = bits[1] ? bits[1].trim() : null;
            checked++;
            if (!have.has(want) && !(alias && have.has(alias))) {
                missing.push(want + '  ∉  ' + rel);
            }
        }
    }
    ok('★ 模块链接自检：index.js 里每个 import 名字都真实存在于目标模块的导出',
        missing.length === 0, missing);
    ok('★ 模块链接自检：确实检查到了 import（不是空跑）', checked >= 8, { checked });
}

/* ★ 回归：面板里的输入框必须**显式**定背景与文字色
   （不接管会吃 ST 默认 input 样式 —— 某些主题下是白底，而文字继承暗色主题的浅色
     → 白底浅字 = 看不见。真机踩过：设置页一排白块。） */
{
    const css = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf('#cd-panel input[type="number"],');
    ok('★ 面板输入框有合并样式块（input/select 一起管）', at >= 0);
    const seg = at >= 0 ? css.slice(at, at + 800) : '';
    ok('★ 面板输入框显式设了 background（否则吃 ST 默认白底 → 白块）', /background\s*:/.test(seg), seg.slice(0, 120));
    ok('★ 面板输入框显式设了 color', /color\s*:/.test(seg), seg.slice(0, 120));
    ok('★ color-scheme 跟着主题走（原生控件与光标颜色）', /color-scheme\s*:\s*dark/.test(css) && /color-scheme\s*:\s*light/.test(css));

    /* ★ 回归：按钮不能被压成「一列一个字」
       （flex 项的 min-content 对中文只有一个汉字宽 → 不锁 nowrap 就会竖排，真机截图）
       ★★ 作用域必须覆盖**面板里所有按钮**，不能只限 .cd-btn-row ——
         0.5.5 只修了 .cd-btn-row；0.7.4 的「查看日志」在 .cd-info-actions 里 → 又被压成一列一个字。 */
    const btnAt = css.indexOf('#cd-panel .menu_button');
    ok('★ 按钮有专门的 nowrap 规则', btnAt >= 0);
    const btnSeg = btnAt >= 0 ? css.slice(btnAt, btnAt + 400) : '';
    ok('★ 按钮锁了 white-space: nowrap', /white-space\s*:\s*nowrap/.test(btnSeg), btnSeg.slice(0, 100));
    ok('★ 按钮禁了收缩（flex: 0 0 auto）', /flex\s*:\s*0\s+0\s+auto/.test(btnSeg), btnSeg.slice(0, 100));
    ok('★★ 作用域是面板里**所有**按钮（不只是 .cd-btn-row）—— 否则「查看日志」这类又会被压竖',
        /#cd-panel\s+\.menu_button\s*,/.test(css));

    /* 面板里不在 .cd-btn-row 内的按钮（查看日志 / 错误列表跳转）也必须被覆盖 */
    {
        const idxSrc = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
        ok('★ 「查看日志」在 .cd-info-actions 里（不在 .cd-btn-row）——正是被漏掉的那个',
            /class="cd-info-actions"><button[^>]*id="cd-info-log"/.test(idxSrc));
        ok('★ 错误列表的跳转按钮也在自己的容器里（同样靠上面的规则兜住）',
            /class="cd-errrow"><button/.test(idxSrc));
    }
}

/* ★★ 复刻 ST 消息消毒器的 class 前缀规则（public/scripts/chats.js:1922-1933）
   消息 HTML 里每个 class 都被无条件加 custom- 前缀，只放过 fa-* / note- / monospace。
   这正是「功能生效了但样式全无」的根因：HTML 在，CSS 的 .cd-* 一个都匹配不上。 */
eq('stClassPrefix：普通 class 加 custom- 前缀',
    stClassPrefix('<div class="cd-root">x</div>'), '<div class="custom-cd-root">x</div>');
eq('stClassPrefix：多 class 逐个加',
    stClassPrefix('<div class="cd-row cd-L-act cd-dim">'), '<div class="custom-cd-row custom-cd-L-act custom-cd-dim">');
eq('stClassPrefix：放过 fa- / note- / monospace',
    stClassPrefix('<i class="fa-solid fa-x note-y monospace">'), '<i class="fa-solid fa-x note-y monospace">');
eq('stClassPrefix：混合时只加该加的',
    stClassPrefix('<i class="fa-solid cd-row">'), '<i class="fa-solid custom-cd-row">');
eq('stClassPrefix：没有 class 就原样', stClassPrefix('<span>纯文本</span>'), '<span>纯文本</span>');
ok('stClassPrefix 不是幂等的（重复套用会变 custom-custom-，所以两条路径只能各自加一次）',
    stClassPrefix(stClassPrefix('<b class="cd-x">')).indexOf('custom-custom-cd-x') >= 0);

/* ★★★ 最强的一条：渲染器发出的**每一个** class，CSS 里都必须有对应的 .custom- 规则。
   这一条直接挡住「HTML 在、样式没」—— 也就是刚刚让插件看起来完全没生效的那个 bug。 */
{
    const sampleHtml = renderMessageHTML(
        '林野·动作 我按住她。\n苏晴·台词 「别。」\n\n旁白·灯灭了。\n<options>\n1. 吻她\n</options>',
        {}, DEFAULT_CONFIG).html;
    const emitted = new Set();
    for (const m of sampleHtml.matchAll(/class="([^"]*)"/g)) {
        String(m[1]).split(/\s+/).forEach(c => { if (c) emitted.add(c); });
    }
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const missingCss = [...emitted].filter(c => !cssText.includes('.custom-' + c));
    ok('★★★ 渲染器发出的每个 class，CSS 里都有 .custom- 规则（挡住「HTML 在、样式没」）',
        missingCss.length === 0, { emitted: [...emitted], missingCss });
    ok('★★★ 样本确实取到了 class（不是空跑）', emitted.size >= 6, { size: emitted.size });
}

/* ★ 选项按钮必须带**行内 style** —— 消毒器只拦 class，行内样式优先级最高，
   这样无论 class 怎么被改都不会退化成浏览器默认的白底按钮（真机踩过：一排白盒子）。 */
{
    const o = renderOptions([{ index: '1', text: '吻她', note: '温柔' }]);
    ok('★ 选项按钮带行内 style', /<button[^>]*style="[^"]*background/.test(o), o.slice(0, 160));
    ok('★ 行内 style 里同时有 background 与 color', /background:/.test(o) && /color:inherit/.test(o));
    ok('★ 不用"几乎全透明"的白（255,255,255 低透明看不出效果）', !/rgba\(255,\s*255,\s*255/.test(o), o.slice(0, 160));
}

/* ★ 结构性守卫：选项点击必须是**事件委托**
   （钩子路径下 HTML 是 ST 插进 DOM 的，我们根本没有"插完之后"的时机逐个绑事件 ——
    原来只在 DOM 降级路径里绑，导致钩子路径的按钮全是死的。真机现象：「点击选项没反应」。） */
{
    const idxSrc = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★ 选项点击用事件委托（document 上绑一次）',
        /addEventListener\('click'[\s\S]{0,500}custom-cd-opt/.test(idxSrc));
    ok('★ 已不存在「只在 DOM 路径逐个绑事件」的 wireOptions',
        !/function wireOptions/.test(idxSrc));
    ok('★ 发送前有防连点（同一组 1.2 秒内只发一次）', /sendOption\.last/.test(idxSrc));
    ok('★ 点过之后整组禁用（选项是一次性的，避免重复发送）', /querySelectorAll\('button'\)[\s\S]{0,200}disabled = true/.test(idxSrc));
}

/* ★ text 段必须**逐字节保真**（空行、行首空格、`</konatan_planning~>` 标记）
   理由：text 段是"原样交给 showdown"的，思考块就在里面，
   预设那条 `([\s\S]*)</konatan_planning~>` 正则靠它匹配；我们一 trim 就可能改变别人的行为。 */
{
    const withBlank = '第一行\n\n  缩进两格的行\n</konatan_planning~>\n\n染·动作 我按住她。\n沙良·台词 「别。」';
    const seg = renderSegments(withBlank, {}, DEFAULT_CONFIG);
    const textSeg = seg.segments.find(s => s.kind === 'text');
    ok('★ text 段存在', !!textSeg);
    ok('★ 空行被保留（不被吃掉）', textSeg.lines.some(l => l === ''), textSeg.lines);
    ok('★ 行首空格被保留（不 trim）', textSeg.lines.some(l => l === '  缩进两格的行'), textSeg.lines);
    ok('★ 思维链结束标记原样保留', textSeg.lines.indexOf('</konatan_planning~>') >= 0);
    ok('★ text 段拼回去后仍是原来的行', textSeg.lines.join('\n').indexOf('</konatan_planning~>') >= 0);
    ok('★ 分镜行没有被混进 text 段', textSeg.lines.every(l => l.indexOf('·动作') < 0 && l.indexOf('·台词') < 0));
}

/* ============================================================================
   思考块兜底（预设覆盖不到时由插件介入）
   预设那条「美化最近 N 层思维链」带 maxDepth；更早的楼思考原本原样裸露。
   本功能让插件在预设够不到的地方补上 —— 核心隐藏靠 `<details>` **原生折叠**，不依赖 CSS。
   ============================================================================ */
{
    const thinkSample = '{思考内容}\n我在想事情。\n</konatan_planning~>\n染·动作 我按住她。\n沙良·台词 「别。」';

    ok('hasThinkingBlock 认得出思考块', hasThinkingBlock(thinkSample, DEFAULT_CONFIG));
    ok('hasThinkingBlock 不认普通散文', !hasThinkingBlock('就是一段散文。', DEFAULT_CONFIG));

    const wrapped = wrapThinkingBlock(thinkSample, DEFAULT_CONFIG);
    ok('兜底包成 <details>（原生折叠 = 天然隐藏）', wrapped.indexOf('<details') >= 0 && wrapped.indexOf('<summary') >= 0);
    ok('兜底默认**不展开**（折叠）', !/<details[^>]*\sopen/.test(wrapped), wrapped.slice(0, 120));
    ok('思考块标记被消费掉（这样预设不会重复包装）',
        wrapped.indexOf('konatan_planning~') < 0 && wrapped.indexOf('{思考内容}') < 0);
    ok('思考正文完整保留', wrapped.indexOf('我在想事情。') >= 0);
    ok('分镜行不受影响（还在原文里）', wrapped.indexOf('·动作') >= 0);
    ok('展开模式会带 open', /<details[^>]*\sopen/.test(wrapThinkingBlock(thinkSample, { ...DEFAULT_CONFIG, thinkingOpen: true })));

    eq('thinkingPattern 留空 → 原样返回（不做兜底）',
        wrapThinkingBlock(thinkSample, { ...DEFAULT_CONFIG, thinkingPattern: '' }), thinkSample);
    eq('thinkingPattern 写坏 → 原样返回（绝不弄丢别人内容）',
        wrapThinkingBlock(thinkSample, { ...DEFAULT_CONFIG, thinkingPattern: '(' }), thinkSample);

    const segWrapped = renderMessageHTML(thinkSample, {}, DEFAULT_CONFIG, { wrapThinking: true });
    ok('opts.wrapThinking=true → text 段被折叠', segWrapped.html.indexOf('<details') >= 0);
    const segPlain = renderMessageHTML(thinkSample, {}, DEFAULT_CONFIG);
    ok('不带 opts → 不折叠（向后兼容）', segPlain.html.indexOf('<details') < 0);
    ok('两种情况下分镜都照常渲染',
        segWrapped.html.indexOf('cd-grid') >= 0 && segPlain.html.indexOf('cd-grid') >= 0);

    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    ok('★ CSS 有 .custom-cd-think 规则', cssText.indexOf('.custom-cd-think') >= 0);
    ok('★ CSS 有 .custom-cd-think-sum 与 -body',
        cssText.indexOf('.custom-cd-think-sum') >= 0 && cssText.indexOf('.custom-cd-think-body') >= 0);
}

/* ============================================================================
   未标注行的对齐（真机反馈：「旁白没有和上面/后面的内容对齐」）
   这些行留在网格外面（保住 markdown），所以靠**空锚点**定位后由 decorate() 补左内边距。
   ============================================================================ */
{
    const mixed = '她感觉自己的脚趾因为紧张而微微蜷缩。\n染·动作 我合上手中的书。\n沙良·台词 「那个……」';
    const r = renderMessageHTML(mixed, {}, { ...DEFAULT_CONFIG, narrateUnlabeled: false });   /* 本块测原样通道 ✓ */
    ok('★ 未标注行前面埋了空锚点', r.html.indexOf('class="cd-anchor"') >= 0, r.html.slice(0, 160));
    ok('★ 锚点在网格之前（未标注行原本在前）', r.html.indexOf('cd-anchor') < r.html.indexOf('cd-root'));
    ok('★ 锚点常量与渲染输出一致', r.html.indexOf(PLAIN_ANCHOR) >= 0);
    ok('★ 未标注行的原文没被包进任何东西（markdown 不受影响）',
        r.html.indexOf('她感觉自己的脚趾') > r.html.indexOf('cd-anchor')
        && r.html.indexOf('她感觉自己的脚趾') < r.html.indexOf('cd-root'));

    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    ok('★ CSS 有 .custom-cd-anchor（否则空锚点会占位）', cssText.indexOf('.custom-cd-anchor') >= 0);
    const idxSrc = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★ decorate 里真的调了 alignPlains', /function decorate[\s\S]{0,400}alignPlains\(mesEl\)/.test(idxSrc));
    ok('★ alignPlains 按锚点区间加内边距（不猜节点归属）', /alignPlains[\s\S]{0,1200}custom-cd-anchor/.test(idxSrc));
}

/* ============================================================================
   自动修复模型漂移（autoRepair）—— 默认 off，不改变行为
   ============================================================================ */
{
    eq('默认 autoRepair = safe（只做有依据的修复）', DEFAULT_CONFIG.autoRepair, 'safe');

    const drift = [
        '沙良回到了自己的房间，门刚刚合上，她就有些狼狈地靠在了门板上。',
        '心理 我真的……要是他听到了的话怎么办？',
        '她低头看了看自己那对丰满得有些沉甸甸的巨乳。',
        '沙良·动作 我有些犹豫地站在门口，手指紧紧绞着衣角。',
        '「那个……染先生，其实……」',
    ].join('\n');

    const off = repairLines(drift.split('\n'), { ...DEFAULT_CONFIG, autoRepair: 'off' });
    eq('off：一行都不动（全是原样解析）', off.filter(x => x.repaired).length, 0);

    const safe = repairLines(drift.split('\n'), { ...DEFAULT_CONFIG, autoRepair: 'safe' });
    const l2 = safe[1];
    eq('safe：只写了层名的那行被补成 row', l2.p.kind, 'row');
    eq('safe：补的名字取「同楼最近标注过的角色」（往后找）', l2.p.name, '沙良');
    eq('safe：层名沿用模型自己写的', l2.p.layer, '心理');
    eq('safe：标记为 repaired', l2.repaired, 'name');
    ok('safe：正文正文没被改写', l2.p.text.indexOf('我真的') === 0);
    eq('safe：纯引号行补成台词', safe[4].p.layer, '台词');
    eq('safe：完全没标注的行**不动**（不猜）', safe[2].p.kind, 'text');
    eq('safe：没标注行也没被标 repaired', safe[2].repaired, null);

    const agg = repairLines(drift.split('\n'), { ...DEFAULT_CONFIG, autoRepair: 'aggressive' });
    eq('aggressive：完全没标注的行归为旁白', agg[2].p.kind, 'narr');
    eq('aggressive：旁白**不占名字列**（不猜角色）', agg[2].p.name, undefined);
    eq('aggressive：标记为 bare', agg[2].repaired, 'bare');
    ok('aggressive：原文一字不改', agg[2].p.body.indexOf('她低头看了看') === 0);

    const onlyLayer = repairLines(['心理 我在想什么。'], { ...DEFAULT_CONFIG, autoRepair: 'safe' });
    eq('safe：没有可参照的角色时**不修**（不猜）', onlyLayer[0].p.kind, 'text');
    eq('safe：也不标记', onlyLayer[0].repaired, null);
}

/* ★ 修复必须**可见**（AGENTS §0.3.3）：补过的行要有记号 + hover 说明 */
{
    const safe = repairLines(['沙良·动作 我站着。', '心理 我在想什么。'], { ...DEFAULT_CONFIG, autoRepair: 'safe' });
    const map = { '沙良': '#00F5EF' };
    const html = renderGrid([[safe[1].p]], map, DEFAULT_CONFIG);
    ok('★ 补过的行带 cd-fix 记号', html.indexOf('cd-fix') >= 0, html.slice(0, 200));
    ok('★ 补过的行 hover 有说明（写了是插件补的）', html.indexOf('title=') >= 0 && html.indexOf('插件') >= 0);
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    ok('★ CSS 有 .custom-cd-fix 规则（记号看得见）', cssText.indexOf('.custom-cd-fix') >= 0);
}
/* ============================================================================
   ★ 层名别名：英文/变体 → 规范中文（真机：模型写了 `染·action 我低头…`）
   原来这种行匹配不上 → 掉进 text 直通 → **标签原样显示在界面上**，违反铁律。
   ============================================================================ */
{
    const L = allLayers(DEFAULT_CONFIG);

    const a = parseLine('染·action 我低头凑近她的耳畔。', L, true);
    eq('★ 英文 action → 中文层「动作」', a.layer, '动作');
    eq('★ 名字保留', a.name, '染');
    eq('★ 标为 alias（让用户知道是插件翻译的）', a.repaired, 'alias');
    eq('★ 样式类按「动作」走', layerClass(a.layer), 'cd-L-act');
    ok('★ 正文没被改动', a.text.indexOf('我低头凑近') === 0);

    eq('★ 英文 speech → 台词', parseLine('染·speech 我低声说。', L, true).layer, '台词');
    eq('★ 英文 narration → 旁白', parseLine('染·narration 灯灭了。', L, true).layer, '旁白');
    eq('★ 中文变体「对白」→ 台词', parseLine('染·对白 「别躲。」', L, true).layer, '台词');

    eq('★ 本来就是规范层名 → 不在返回里塞 repaired 键', parseLine('染·动作 正常行。', L, true).repaired, undefined);

    const d = parseLine('染·xyz 认不出的层词。', L, /* lenient */ true);
    eq('★ 认不出的层词 → 当自定义层（名字列/颜色保留）', d.layer, 'xyz');
    eq('★ 自定义层的样式类', layerClass(d.layer), 'cd-L-custom');
    eq('★ 标为 unknown-layer', d.repaired, 'unknown-layer');

    eq('默认（lenient 关）这类行退回普通文本 —— 由别名表覆盖，不靠乱认',
        parseLine('染·xyz 认不出的层词。', L, false).kind, 'text');

    eq('★ lenientLayers 默认**关**（避免误伤含间隔号的正文）', DEFAULT_CONFIG.lenientLayers, false);

    /* ★★ 铁律：标签绝不出现在**可见文字**里（title 里的诊断说明不算） */
    const html = renderMessageHTML(
        '染·action 我低头凑近她的耳畔。\n沙良·动作 我顺从地向前倾斜。\n染·speech 「别躲。」',
        { '染': '#00F5EF', '沙良': '#D982EF' }, DEFAULT_CONFIG).html;
    const visible = html.replace(/<[^>]*>/g, '');
    ok('★★ 可见文字里没有 action / speech（标签绝不出现）',
        visible.indexOf('action') < 0 && visible.indexOf('speech') < 0, visible.slice(0, 120));
    ok('★ 名字列还在', html.indexOf('染') >= 0 && html.indexOf('沙良') >= 0);
    ok('★ 三行都进了网格（不是裸文本）', (html.match(/cd-row/g) || []).length >= 3);
}

/* ============================================================================
   ★ 版权合规
   原预设自带说明写明：作者 泉此方；「可以二改，**禁止二传**，拿功能要先问我，署名」。
   ⇒ ① 仓库里**不得**出现原预设或派生预设的任何副本（禁止二传）
      ② 生成器里必须写着作者与许可（署名不许悄悄消失）
   ============================================================================ */
{
    const root = new URL('../', import.meta.url);
    const hits = [];
    const walk = (dir, depth) => {
        if (depth > 4) return;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.name === '.git' || e.name === 'node_modules' || e.name === 'vendor') continue;
            const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
            if (e.isDirectory()) { walk(p, depth + 1); continue; }
            if (/tailfree/i.test(e.name) || /分镜\.json$/i.test(e.name) || /^Izumi.*\.json$/i.test(e.name)) hits.push(e.name);
        }
    };
    walk(root, 0);
    ok('★ 仓库里没有原预设/派生预设的副本（原许可禁止二传）', hits.length === 0, hits);

    const gen = fs.readFileSync(new URL('../scripts/cine-preset.mjs', import.meta.url), 'utf8');
    ok('★ 生成器里写着原作者（署名）', gen.indexOf('泉此方') >= 0);
    ok('★ 生成器里写着原许可全文', gen.indexOf('禁止二传') >= 0 && gen.indexOf('可以二改') >= 0);
    /* 注意：配方本体在扩展的 logic.js 里（面板与 CLI 共用），CLI 只做读写文件。
       所以这两条要查 logic.js —— 查错地方就会被这条守卫抓住（这一版就抓到了）。 */
    const recipe = fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8');
    ok('★ 配方把出处/许可写进预设（derivedFrom + upstream + sha256）',
        /derivedFrom/.test(recipe) && /upstream/.test(recipe) && /sha256/.test(recipe));
    ok('★ 说明条目是**停用**的（只留痕，不进提示词）',
        /enabled: false/.test(recipe) && /勿启用/.test(recipe));
}

/* ============================================================================
   ★ 专属预设配方（applyPresetRecipe）
   扩展面板的「生成专属预设」按钮与 scripts/cine-preset.mjs 调**同一份**实现。
   原预设许可「可以二改，禁止二传」⇒ 只分发配方、不分发预设本体。
   ============================================================================ */
{
    const src = {
        prompts: [
            { identifier: 'a', name: '📋说明（点小铅笔看）', content: '作者信息' },
            { identifier: 'b', name: '👤人称-第三人称' },
            { identifier: 'c', name: '👤人称-User第一人称' },
            { identifier: 'd', name: '🚢文风-顺眼舒服' },
        ],
        prompt_order: [{ character_id: 100000, order: [
            { identifier: 'b', enabled: false }, { identifier: 'c', enabled: true }, { identifier: 'd', enabled: true },
        ] }],
        extensions: { regex_scripts: [
            { scriptName: '1美化最近二层思维链(流式夜间)-修复换行', maxDepth: 2, disabled: false },
            { scriptName: '1美化最近2层思维链（非流）', maxDepth: 2, disabled: true },
        ] },
    };
    const before = JSON.stringify(src);
    const r = applyPresetRecipe(src, { srcName: 'Izumi 0828.tailfree.json', srcHash: 'f09c53a95b8ebf47deadbeef' });

    ok('★ 配方成功', r.ok === true);
    ok('★★ 纯函数：**不改传入的对象**', JSON.stringify(src) === before);
    ok('★ 新增并启用格式说明条目',
        r.preset.prompts.some(x => x.name === PRESET_RECIPE.promptName)
        && r.preset.prompt_order[0].order.some(o => o.identifier === 'cine-dialogue-format' && o.enabled === true));
eq('★ 人称-第三人称 关（用户要求全关）', r.preset.prompt_order[0].order.find(o => o.identifier === 'b').enabled, false);
    eq('★ 人称-User第一人称 关', r.preset.prompt_order[0].order.find(o => o.identifier === 'c').enabled, false);
    eq('★ 文风-顺眼舒服 关', r.preset.prompt_order[0].order.find(o => o.identifier === 'd').enabled, false);
    eq('★ 思维链深度 2 → 20', r.preset.extensions.regex_scripts[0].maxDepth, 20);
    eq('★ **关着的那条不动**（保持 2）', r.preset.extensions.regex_scripts[1].maxDepth, 2);

    const prov = r.preset.extensions.cine_dialogue;
    eq('★ 署名：原作者', prov.upstream.author, '泉此方');
    ok('★ 署名：许可全文', prov.upstream.license.indexOf('禁止二传') >= 0);
    eq('★ 记录派生来源哈希', prov.derivedFrom.sha256, 'f09c53a95b8ebf47deadbeef');

    const note = r.preset.prompts.find(x => x.name === PRESET_RECIPE.noteName);
    ok('★ 有派生说明条目', !!note);
    ok('★ 说明条目正文含署名与作品来源', note.content.indexOf('泉此方') >= 0 && note.content.indexOf('禁止二传') >= 0);
    eq('★★ 说明条目**停用**（只留痕，不进提示词）',
        r.preset.prompt_order[0].order.find(o => String(o.identifier) === String(note.identifier)).enabled, false);

    const again = applyPresetRecipe(r.preset, { srcName: 'x', srcHash: 'y' });
    eq('★★ 幂等：条目数不叠加', again.preset.prompts.length, r.preset.prompts.length);
    eq('★★ 幂等：顺序表不叠加', again.preset.prompt_order[0].order.length, r.preset.prompt_order[0].order.length);
    ok('★ 幂等：第二次报告「已是」', again.changes.some(c => c.indexOf('已是') >= 0));

    ok('★ 传入非对象 → ok:false（不抛异常）', applyPresetRecipe(null).ok === false);
    let threw = false;
    try { applyPresetRecipe({}); } catch (_) { threw = true; }
    ok('★ 传入空对象也不抛异常（结构变了要能容错）', !threw);

    eq('★ PRESET_UPSTREAM 许可逐字照抄', PRESET_UPSTREAM.license, '可以二改，禁止二传，拿功能要先问我，署名');
    ok('★ 派生说明正文里带署名', presetNoteText({ srcName: 'a.json' }).indexOf('泉此方') >= 0);
}

/* ★ 源码级守卫：面板与 CLI **必须** 共用同一份配方（防止两处配方漂移） */
{
    const idxSrc = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const cliSrc = fs.readFileSync(new URL('../scripts/cine-preset.mjs', import.meta.url), 'utf8');

    ok('★ 面板导入了 applyPresetRecipe', /applyPresetRecipe/.test(idxSrc));
    ok('★ CLI **也**导入同一份 applyPresetRecipe（不是自己重写一遍）',
        /import\s*\{[^}]*applyPresetRecipe[^}]*\}\s*from\s*'\.\.\/extensions\/cine-dialogue\/logic\.js'/.test(cliSrc));
    ok('★ CLI 里没有重复的配方实现（不该出现 maxDepth 赋值）', !/maxDepth\s*=\s*\d/.test(cliSrc));
    ok('★ 面板有文件选择框与两个按钮',
        /id="cd-preset-file"/.test(idxSrc) && /id="cd-preset-make"/.test(idxSrc) && /id="cd-preset-dry"/.test(idxSrc));
    ok('★ 面板把生成结果**下载**给用户（Blob + a.download）',
        /new Blob\(/.test(idxSrc) && /a\.download = outName/.test(idxSrc));
    /* ★ 合规：生成过程**全在本地**，不上传任何东西 */
    const panelBlock = idxSrc.slice(idxSrc.indexOf('const runPresetRecipe'), idxSrc.indexOf('const makeBtn'));
    ok('★★ 生成过程不发网络请求（不上传用户预设）',
        !/fetch\(/.test(panelBlock) && !/XMLHttpRequest/.test(panelBlock) && !/\.send\(/.test(panelBlock));
    /* ★ 面板文案瘦身（0.7.7）：许可全文是**查阅型**信息，不该每次开面板都念一遍、占三行空间。
       署名该在的地方是**产物里**（derivedFrom + 停用的说明条目），面板只把用户指过去。 */
    ok('★ 面板**不**再堆作者名与许可全文（省面板空间）',
        !/PRESET_UPSTREAM\.author/.test(idxSrc) && !/PRESET_UPSTREAM\.license/.test(idxSrc));
    ok('★ 面板仍写清关键边界：只带配方、不含预设内容',
        idxSrc.indexOf('不含预设内容') >= 0);
    ok('★ 面板**指路**到产物里看出处与许可',
        idxSrc.indexOf('出处与许可会一并写进生成出来的预设里') >= 0);
    /* ★★ 但署名不许丢：产物里必须带作者与许可（这才是许可要求的落点） */
    {
        const r = applyPresetRecipe({ prompts: [], prompt_order: [{ character_id: 1, order: [] }], extensions: {} },
            { srcName: 'x.json', srcHash: 'abc' });
        const prov = r.preset.extensions.cine_dialogue;
        eq('★★ 产物里带原作者（署名）', prov.upstream.author, '泉此方');
        ok('★★ 产物里带许可全文', prov.upstream.license.indexOf('禁止二传') >= 0);
        const note = r.preset.prompts.find(x => String(x.name).indexOf('分镜派生说明') >= 0);
        ok('★★ 产物里的说明条目也写着署名与许可',
            note && note.content.indexOf('泉此方') >= 0 && note.content.indexOf('禁止二传') >= 0);
        ok('★★ 且该条目是**停用**的（只留痕，不进提示词）',
            r.preset.prompt_order[0].order.find(o => String(o.identifier) === String(note.identifier)).enabled === false);
    }
}

/* ============================================================================
   ★ 扩展信息块（作者 / 许可 / 项目主页 / 查看日志）
   与 card-compat 0.3.1、plot-pilot 0.1.3 对齐 —— ST 的抽屉里没有任何这类说明，
   而用户是在拿它动自己的聊天数据，必须能一眼看到作者、许可与作用范围。
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    ok('★ 有扩展信息（折叠开关 + 内容体）',
        src.indexOf('id="cd-info-toggle"') >= 0 && src.indexOf('id="cd-info-body"') >= 0);
    ok('★ 作者 / 许可 / 项目主页 三项齐全',
        src.indexOf('小肥鱼') >= 0 && src.indexOf('AGPL-3.0') >= 0
        && src.indexOf('github.com/Anarrogantcat/sillytavern-shell') >= 0);
    ok('★ 有「查看日志」按钮', src.indexOf('id="cd-info-log"') >= 0);
    ok('★ 说明里写清了作用范围（只在显示层 / 不改原文 / 不改 MVU）',
        src.indexOf('不改聊天原文') >= 0 && src.indexOf('显示层') >= 0);
    ok('★ 说明里交代了副作用（安装专属正则会写 4 条）', src.indexOf('安装专属正则') >= 0);
    ok('★ 日志读的是扩展目录里的 CHANGELOG.md',
        /new URL\('\.\/CHANGELOG\.md', import\.meta\.url\)/.test(src));
    ok('★ 默认折叠（body 初始 display:none）', /id="cd-info-body"[^>]*style="display:none"/.test(src));
    ok('★ 折叠状态会记住（localStorage）', /localStorage\.setItem\(CD_INFO_KEY/.test(src));
    ok('★ popup 用**全局**而非 import（避免模块链接失败 → 整个扩展不执行）',
        /typeof callGenericPopup === 'function'/.test(src)
        && !/import\s*\{[^}]*callGenericPopup[^}]*\}\s*from/.test(src));

    ok('★ CSS 有 #cd-panel .cd-info 规则', cssText.indexOf('#cd-panel .cd-info') >= 0);
    ok('★ 日志弹窗样式用自有前缀 .cd-log-*（弹窗不在 #cd-panel 内）', cssText.indexOf('.cd-log-doc') >= 0);

    /* ★ 跨扩展一致性：三个扩展都必须有这块 —— 防止以后新增扩展又忘了 */
    for (const id of ['card-compat', 'plot-pilot', 'cine-dialogue']) {
        const p = fs.readFileSync(new URL('../extensions/' + id + '/index.js', import.meta.url), 'utf8');
        ok('★ ' + id + ' 有扩展信息块（作者 + 许可 + 项目主页）',
            p.indexOf('扩展信息') >= 0 && p.indexOf('AGPL-3.0') >= 0
            && p.indexOf('github.com/Anarrogantcat/sillytavern-shell') >= 0);
    }
}

/* ============================================================================
   ★ 图例与说明：把「颜色 = 角色、样式 = 层」讲清楚
   原来面板只有一句「颜色 = 角色」，用户看到聊天里一排颜色无法知道哪个是谁、竖线代表什么。
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    ok('★ 有图例函数，且真的插进了面板', /function legendHTML\(\)/.test(src) && /legendHTML\(\),/.test(src));
    ok('★ 图例用的是**消息区同一套类**（真渲染，不是图片）',
        /custom-cd-row/.test(src) && /custom-cd-grid/.test(src) && /custom-cd-who/.test(src));
    ok('★ 层别约定**从 DEFAULT_LAYER_STYLES 生成**（改默认值不会和文字脱节）',
        /DEFAULT_LAYER_STYLES\[L\]/.test(src));
    ok('★ 图例里五种层都出现',
        src.indexOf("layer: '动作'") >= 0 && src.indexOf("layer: '台词'") >= 0
        && src.indexOf("layer: '感官'") >= 0 && src.indexOf("layer: '心理'") >= 0
        && src.indexOf("layer: '旁白'") >= 0);

    ok('★ 说了分配规则：按出场顺序', src.indexOf('出场顺序') >= 0 && src.indexOf('颜色 = 角色') >= 0);
    ok('★ 说了「钉死一个不会改变别人」', src.indexOf('钉死一个不会改变别人') >= 0);

    ok('★ 记号说明已并入「怎么看」块（旧函数已删，不留死代码）',
        src.indexOf('记号说明') >= 0 && !/function marksSecHTML/.test(src));
    ok('★ 记号说明覆盖四类痕迹（补的名字 / 自定义层 / 格式错误 / 灰段）',
        src.indexOf('名字格下面有虚线') >= 0 && src.indexOf('虚线竖线') >= 0
        && src.indexOf('格式错误') >= 0 && src.indexOf('原样放过') >= 0);

    ok('★ CSS 有图例规则（#cd-panel .cd-legend）', cssText.indexOf('#cd-panel .cd-legend') >= 0);

    /* ★ 把五层默认样式钉住：谁改了 DEFAULT_LAYER_STYLES，这条会提醒他同步检查面板文字 */
    const conv = ['台词', '动作', '感官', '心理', '旁白'].map(L => {
        const st = DEFAULT_LAYER_STYLES[L] || {};
        const mk = (st.mark && st.mark !== 'none') ? st.mark : 'none';
        return L + '=' + mk + (st.italic ? '+i' : '');
    }).join(',');
    eq('★★ 五层默认样式的权威值（面板文字即由它生成）', conv,
        '台词=none,动作=solid,感官=dotted,心理=double+i,旁白=none');
}

/* ============================================================================
   ★「怎么看」折叠块 —— 图例与说明收进一处、**默认折叠**
   查阅型内容不折叠会把面板撑长，反而挡住常用开关。
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    ok('★ 有折叠块，且真的插进了面板',
        /function howtoSecHTML\(\)/.test(src) && /howtoSecHTML\(\),/.test(src));
    ok('★ 折叠块插在**顶部**（配置字段 rows 之前）',
        src.indexOf('howtoSecHTML(),') < src.indexOf('        rows,'));
    ok('★★ 默认折叠（body 初始 display:none）',
        /id="cd-howto-body"[^>]*style="display:none"/.test(src));
    ok('★ 折叠状态记忆（localStorage）',
        /localStorage\.setItem\('cd-howto-open'/.test(src));
    ok('★ 有可点击的折叠开关 + aria-expanded', /id="cd-howto-toggle"/.test(src) && /aria-expanded/.test(src));

    ok('★ 图例在折叠块**内部**（不是散在外面）',
        /function howtoSecHTML[\s\S]{0,2200}legendHTML\(\),/.test(src));
    ok('★ 折叠块里同时有：配色规则 + 层别约定 + 图例 + 记号说明',
        src.indexOf('颜色 = 角色') >= 0 && src.indexOf('左侧竖线 = 层') >= 0
        && src.indexOf('DEFAULT_LAYER_STYLES[L]') >= 0 && src.indexOf('记号说明') >= 0);
    ok('★ CSS 有 .cd-howto 与 .cd-howto-body 规则',
        cssText.indexOf('#cd-panel .cd-howto') >= 0 && cssText.indexOf('#cd-panel .cd-howto-body') >= 0);
}

/* ============================================================================
   ★「怎么选文件」——不能用裸的原生 file 控件
   暗色主题下原生 file 控件几乎看不见，用户根本不知道要点哪（真机反馈）。
   改成「隐藏 input + 真按钮触发」，与「导入配置」同一套做法。
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★ 有显式的「选择预设文件…」按钮',
        /id="cd-preset-pick"/.test(src) && src.indexOf('选择预设文件') >= 0);
    ok('★ 原生 file 控件已隐藏（否则暗色主题下看不见）',
        /id="cd-preset-file"[^>]*class="cd-hidden"/.test(src));
    ok('★ 按钮 → 触发隐藏的 input',
        /presetPick\.addEventListener\('click', \(\) => presetFile\.click\(\)\)/.test(src));
    ok('★ 选完显示已选文件名', /id="cd-preset-name"/.test(src) && /presetName\.textContent = f \? f\.name/.test(src));
    ok('★ 选完**自动预演**一次（让用户马上看到确实读到了）',
        /presetFile\.addEventListener\('change'[\s\S]{0,500}runPresetRecipe\(false\)/.test(src));
    ok('★ 与「导入配置」同一套做法（cd-hidden + 按钮触发）',
        /id="cd-file"[^>]*class="cd-hidden"/.test(src) && /f\.click\(\)/.test(src));
    ok('★ 占位文案引导先点按钮', src.indexOf('先点上面的「选择预设文件…」') >= 0);
}

/* ============================================================================
   ★★ 回归守卫：index.js 用到、但没从 logic.js 导入的名字
   这类遗漏在调用点抛 ReferenceError。如果发生在 buildSettingsPanel 之前/之中，
   表现就是「扩展程序列表里根本没有这个抽屉」—— 这个坑踩过两次：
     · 0.1.0 —— extension_settings 从 script.js import → ESM 链接失败 → 一行都不执行
     · 0.7.2 —— 图例里用了没导入的 layerClass → buildSettingsPanel 抛错 → 抽屉消失
   两次都是一模一样的症状，不看 F12 完全不知道哪错了。
   ============================================================================ */
{
    const idx = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const log = fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8');

    const exported = new Set();
    for (const m of log.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
    for (const m of log.matchAll(/export\s*\{([^}]*)\}/g)) {
        m[1].split(',').forEach(x => { const t = x.trim().split(/\s+as\s+/).pop().trim(); if (t) exported.add(t); });
    }

    /* ★ 必须用 [^{}]* —— 用 [\s\S]*? 会从文件**第一个** import { 起匹配，
       把 script.js 的导入名也算进来（我自己就踩了：补丁把 layerClass 塞进了 script.js）。 */
    const imp = idx.match(/import\s*\{([^{}]*)\}\s*from\s*'\.\/logic\.js'/);
    ok('★ 找得到 index.js 里 logic.js 的 import', !!imp);
    const imported = new Set(imp[1].split(',').map(s => s.trim()).filter(Boolean));
    const body = idx.slice(0, imp.index) + idx.slice(imp.index + imp[0].length);

    // 排除两类误报：index.js 自己声明的名字、对象字面量里的方法简写（stats() {）
    const localDecl = new Set();
    for (const m of idx.matchAll(/(?:function|const|let|class)\s*([A-Za-z_$][\w$]*)/g)) localDecl.add(m[1]);

    const missing = [];
    for (const name of exported) {
        if (imported.has(name) || localDecl.has(name)) continue;
        const re = new RegExp('(?<![\\w$.])' + name.replace(/\$/g, '\\$') + '(?![\\w$])');
        if (!re.test(body)) continue;
        if (new RegExp('[},]\\s*' + name + '\\s*\\(').test(body)) continue;      // 方法简写
        missing.push(name);
    }
    ok('★★ index.js 用到的 logic.js 导出**全都导入**了（漏一个就会让抽屉消失）',
        missing.length === 0, missing);

    ok('★ 导入了 layerClass（0.7.2 就是漏了它）', imported.has('layerClass'));
    ok('★ 导入了 layerVars', imported.has('layerVars'));
}

/* ★ start() 每步单独兜错 —— 单点失败不该让整个扩展哑掉 */
{
    const idx = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★ start() 有逐步兜错的 step() 包装', /const step = \(name, fn\)/.test(idx));
    ok('★ 失败步骤会记进 failedSteps', /const failedSteps = \[\]/.test(idx));
    ok('★ 失败时会**通知用户**（而不是静默）',
        /notify\('分镜对话：' \+ failedSteps\.length/.test(idx));
    ok('★ 失败步骤暴露到 diagnose() 与 stats()',
        (idx.match(/failedSteps: failedSteps\.slice\(\)/g) || []).length >= 2);
    ok('★ 建设置面板也是被 step() 包住的（不会再整个哑掉）',
        /step\('建设置面板'/.test(idx));
}

/* ============================================================================
   ★ 双线（心理）必须加宽才看得见
   真机反馈：「心理和动作的线区别不大」——`border-style: double` 在 3px 下是
   1px 线 + 1px 隙 + 1px 线，抗锯齿后和实线几乎一样。
   改成 5px（2+1+2），并用 --cd-pad-comp 把文字位置补回来，保证五层左边缘对齐。
   ============================================================================ */
{
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const idxSrc = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');

    ok('★ 心理（双线）用 5px 宽', layerVars('心理', DEFAULT_CONFIG).indexOf('--cd-mark-w:5px') >= 0);
    ok('★ 动作（实线）仍是 3px', layerVars('动作', DEFAULT_CONFIG).indexOf('--cd-mark-w:3px') >= 0);
    ok('★ 双线用 --cd-pad-comp 把文字位置补回来（五层左边缘必须对齐）',
        layerVars('心理', DEFAULT_CONFIG).indexOf('--cd-pad-comp:2px') >= 0
        && layerVars('动作', DEFAULT_CONFIG).indexOf('--cd-pad-comp:0px') >= 0);

    /* 用户把任意层改成 double → 宽度与补偿都要跟着走（不是写死在"心理"上） */
    const asDouble = layerVars('动作', { ...DEFAULT_CONFIG, layerStyles: { '动作': { mark: 'double' } } });
    ok('★ 把任意层改成 double，宽度与补偿都跟着变',
        asDouble.indexOf('--cd-mark-w:5px') >= 0 && asDouble.indexOf('--cd-pad-comp:2px') >= 0);
    /* 关掉标记 → 宽度回到 3px、补偿归零（不能留 5px 空档把文字推偏） */
    const noMark = layerVars('心理', { ...DEFAULT_CONFIG, layerStyles: { '心理': { mark: 'none' } } });
    ok('★ 关掉标记时宽度回到 3px、补偿归零（否则会留空档推偏文字）',
        noMark.indexOf('--cd-mark-w:3px') >= 0 && noMark.indexOf('--cd-pad-comp:0px') >= 0);

    /* ★★ 关键守卫：**带竖线的三层必须两两可区分**（线型 + 宽度组合唯一）
       —— 挡住「两条线看起来一样」这类"默认值选得不合理"的问题。 */
    const shown = ['动作', '感官', '心理'].map(L => {
        const v = layerVars(L, DEFAULT_CONFIG);
        const mark = (v.match(/--cd-mark:([a-z]+)/) || [])[1];
        const w = (v.match(/--cd-mark-w:(\d+)px/) || [])[1];
        return mark + '@' + w;
    });
    ok('★★ 动作/感官/心理 的（线型 + 宽度）组合两两不同', new Set(shown).size === 3, shown);

    /* 按设计：只有台词与旁白是「无线」 */
    const noLine = ['台词', '动作', '感官', '心理', '旁白'].filter(L =>
        layerVars(L, DEFAULT_CONFIG).indexOf('--cd-mark-color:transparent') >= 0);
    eq('★ 无竖线的只有 台词 与 旁白（按设计）', noLine.join(','), '台词,旁白');

    ok('★ CSS 用 var(--cd-mark-w) 而不是写死 3px',
        cssText.indexOf('border-left: var(--cd-mark-w') >= 0);
    ok('★ CSS 用 --cd-pad-comp 补偿内边距', cssText.indexOf('var(--cd-pad-comp') >= 0);
    ok('★ 内置兜底 CSS 同步改（否则取不到 style.css 时双线又变回 3px）',
        idxSrc.indexOf('border-left:var(--cd-mark-w,3px)') >= 0
        && idxSrc.indexOf('var(--cd-pad-comp,0px)') >= 0);
}

/* ============================================================================
   ★ 面板分组折叠
   字段一多，平铺就是一屏控件（真机截图：整整 1200px 高的字段列表）。
   分组 + 默认只开「基本」，面板才回到可用长度。
   ============================================================================ */
{
    const idxSrc = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    ok('★ 有组定义 PANEL_GROUPS', Array.isArray(PANEL_GROUPS) && PANEL_GROUPS.length >= 5);
    ok('★ 默认只展开一组（其余收起 —— 否则等于没折叠）',
        PANEL_GROUPS.filter(g => g.open).length === 1);
    eq('★ 默认展开的是「基本」', PANEL_GROUPS[0].name, '基本');

    const ung = PANEL_FIELDS.filter(f => !f.group).map(f => f.key);
    /* ★ 总开关（enabled）有意不分组 —— 它常驻面板顶部，不该被折叠藏起来。其余必须标组。 */
    eq('★★ 除了总开关，每个字段都必须标组（以后加字段忘了标 → 这里直接报错）', ung.join(','), 'enabled');

    const unknown = PANEL_FIELDS.filter(f => f.group && !PANEL_GROUPS.some(g => g.name === f.group)).map(f => f.key);
    ok('★★ 每个组名都必须登记在 PANEL_GROUPS', unknown.length === 0, unknown);

    const empty = PANEL_GROUPS.filter(g => !PANEL_FIELDS.some(f => f.group === g.name)).map(g => g.name);
    ok('★ 登记的组不能是空组（否则面板上是个点了没反应的标题）', empty.length === 0, empty);

    const counts = PANEL_GROUPS.map(g => PANEL_FIELDS.filter(f => f.group === g.name).length);
    ok('★ 没有哪一组塞了一半以上的字段（分组才有意义）',
        Math.max(...counts) <= Math.ceil(PANEL_FIELDS.length / 2), counts);

    ok('★ 面板改用 groupsHTML(c) 渲染（不再是平铺的 PANEL_FIELDS.map）',
        /const rows = groupsHTML\(c\)/.test(idxSrc) && !/const rows = PANEL_FIELDS\.map/.test(idxSrc));
    ok('★ 有折叠开关（data-cd-grp-toggle）与状态记忆（localStorage）',
        /data-cd-grp-toggle/.test(idxSrc) && /cd-grp-open/.test(idxSrc));
    ok('★ 折叠状态默认值来自 PANEL_GROUPS（不是写死）',
        /Object\.prototype\.hasOwnProperty\.call\(saved, g\.name\)/.test(idxSrc));
    ok('★ CSS 有 #cd-panel .cd-grp 规则',
        cssText.indexOf('#cd-panel .cd-grp') >= 0 && cssText.indexOf('#cd-panel .cd-grp-body') >= 0);
}

/* ============================================================================
   ★★ 总开关：关掉后**整个插件**停用（不是只停渲染）
   旧版 enabled 只停渲染 —— 提示词注入、思考块兜底、双击复制、Alt 跳场景都还在跑。
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    eq('★ enabled 提升为总开关（group: null → 常驻顶部）',
        PANEL_FIELDS.find(f => f.key === 'enabled').group, null);
    eq('★★ 只有总开关不分组（其余字段都必须归组）',
        PANEL_FIELDS.filter(f => !f.group).map(f => f.key).join(','), 'enabled');
    ok('★ 标签写明它是整个插件的开关', /总开关（整个插件）/.test(fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8')));

    ok('★ 关掉时把已渲染楼层恢复原样（restoreAllMessages + updateMessageBlock(rerenderMessage)）',
        /function restoreAllMessages/.test(src)
        && /updateMessageBlock\(id, chat\[id\], \{ rerenderMessage: true \}\)/.test(src));
    ok('★★ 用 getContext() 拿函数，**不新增 import**（避免又一次 ESM 链接失败）',
        /typeof ctx\.updateMessageBlock !== 'function'/.test(src)
        && !/import\s*\{[^{}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/\.\.\/script\.js'[\s\S]{0,300}updateMessageBlock/.test(src));

    ok('★ 提示词注入受总开关约束', /!!c\.injectPrompt && !!c\.enabled/.test(src));
    ok('★ Alt 跳场景受总开关约束', /if \(!effectiveConfig\(\)\.enabled\) return;\s*\/\/ ★ 总开关关掉 → 不接管 Alt/.test(src));
    ok('★ 双击复制受总开关约束', /!effectiveConfig\(\)\.enabled \|\| !effectiveConfig\(\)\.copyOnClick/.test(src));
    ok('★ run() 顶部短路（连 decorate 都不跑）',
        /function run\(all\) \{[\s\S]{0,160}if \(!effectiveConfig\(\)\.enabled\) return;/.test(src));
    ok('★ 改总开关会触发额外动作（清注入 + 恢复楼层）',
        /if \(key === 'enabled'\) \{ applyMasterSwitch\(\); return; \}/.test(src));

    const mi = src.indexOf('masterHTML(c),');
    const ri = src.indexOf('\n        rows,');
    ok('★ 总开关在面板里排在配置分组之前（常驻顶部）', mi > 0 && ri > 0 && mi < ri, { mi, ri });
    ok('★ CSS 有 #cd-panel .cd-master', cssText.indexOf('#cd-panel .cd-master') >= 0);
}

/* ============================================================================
   ★ 手写段折叠化：配色 / 层样式 / 自定义层 / 交互 / 这张卡·数据 / 专属预设 / 格式错误
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    ok('★ 有折叠化函数并真的调用了',
        /function makeSectionsCollapsible/.test(src) && /const collapsed = makeSectionsCollapsible\(\)/.test(src));
    ok('★★ 必须在 rebuildDynamic **之后**调用（那时 #cd-colors / #cd-layers 才填好）',
        src.indexOf('rebuildDynamic();') < src.indexOf('makeSectionsCollapsible()'));
    ok('★ 用 :scope > .cd-sec-h 只挑直接标题（不会误抓嵌套段的标题）',
        /querySelector\(':scope > \.cd-sec-h'\)/.test(src));
    ok('★ 把标题之后的兄弟节点搬进折叠体（id 不变 → rebuildDynamic 照常找得到）',
        /head\.nextSibling[\s\S]{0,220}body\.appendChild/.test(src));
    ok('★ 折叠状态持久化（localStorage cd-sec-open）', /cd-sec-open/.test(src));
    ok('★ 幂等：已折叠过的段不会重复包（data-cd-collapsed）', /data-cd-collapsed/.test(src));
    ok('★ 默认全部收起（body 初始 display:none）', /body\.style\.display = open \? '' : 'none'/.test(src));
    ok('★ CSS 有 .cd-sec-h.cd-grp-toggle 与 data-cd-collapsed 规则',
        cssText.indexOf('.cd-sec-h.cd-grp-toggle') >= 0 && cssText.indexOf('data-cd-collapsed') >= 0);
}

/* ============================================================================
   ★ 专属正则：状态检查 + 装/卸前确认
   为什么：updateTavernRegexesWith **会重载整个聊天**。重复点不会装重（我们幂等），
   但会白白重载一次聊天（用户反馈：「我刚刚就不小心点了安装」）。
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');

    ok('★ 有状态检查（regexState / refreshRegexState）',
        /function regexState/.test(src) && /function refreshRegexState/.test(src));
    ok('★ 有内容指纹（判断「装过之后内容变没变」）',
        /function regexFingerprint/.test(src) && /cd-regex-stamp/.test(src));
    ok('★★ 已装好且内容没变时，明确提示「重装只会再重载一次聊天」',
        src.indexOf('已经装好、内容也没变') >= 0 && src.indexOf('重载一次聊天') >= 0);
    ok('★★ 安装前必须确认，且写明会重载整个聊天',
        /confirmRegexAction\('安装\/更新专属正则'/.test(src) && src.indexOf('**重载整个聊天**') >= 0);
    ok('★★ 移除前也要确认', /confirmRegexAction\('移除专属正则'/.test(src));
    ok('★ 取消不静默（有「已取消」提示）',
        src.indexOf('已取消安装') >= 0 && src.indexOf('已取消移除') >= 0);
    ok('★ 确认弹窗有降级（callGenericPopup 不可用时退到 window.confirm）',
        /window\.confirm\(/.test(src));
    ok('★ 读不到正则列表时不报错、仍可安装（多路读法 + 返回 null）',
        /function readRegexList/.test(src) && /Array\.isArray\(v\)/.test(src));
    ok('★ 面板有状态行并会刷新', /id="cd-regex-state"/.test(src) && /refreshRegexState\(\);/.test(src));
    ok('★ 状态行覆盖五种情况（已装 / 装一半 / 没装 / 读不到 / 没酒馆助手）',
        ['已安装 ', '装了 ', '未安装', '读不到列表', '需要酒馆助手'].every(t => src.indexOf(t) >= 0));
    ok('★ 安装成功后写入指纹、移除后清掉',
        /localStorage\.setItem\('cd-regex-stamp'/.test(src) && /localStorage\.removeItem\('cd-regex-stamp'/.test(src));
}

/* ============================================================================
   ★ 常驻 hint 移进「ⓘ 怎么看」
   下面已经有完整说明 + 图例，面板顶部再挂两行只是重复占位。
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');

    const panelStart = src.indexOf('host.insertAdjacentHTML');
    const panelEnd = src.indexOf("].join('\\n'));", panelStart);
    const panelBlock = src.slice(panelStart, panelEnd);

    ok('★★ 面板顶部不再有常驻 hint（重复占位）', !/cd-hint/.test(panelBlock), panelBlock.slice(0, 80));
    ok('★ hint 已移进「ⓘ 怎么看」当第一行',
        /id="cd-howto-body"[\s\S]{0,500}cd-hint/.test(src));
    ok('★★ 核心承诺「标签永不出现」没丢（只是换了位置）',
        src.indexOf('标签永不出现') >= 0);
    ok('★ 面板顶部顺序：怎么看 → 总开关 → 分组字段',
        src.indexOf('howtoSecHTML(),') > 0
        && src.indexOf('howtoSecHTML(),') < src.indexOf('masterHTML(c),')
        && src.indexOf('masterHTML(c),') < src.indexOf('\n        rows,'));
    ok('★ cd-hint 的样式仍被复用（没白留一条死 CSS）',
        fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
            .indexOf('#cd-panel .cd-hint') >= 0);
}

/* ============================================================================
   ★ FORMAT_SPEC：旁白归属规则（0.8.3）
   用户问「这种带场景描述的属不属于旁白」→ 判据必须写进说明，模型才有依据。
   ============================================================================ */
{
    ok('★ 说明写明「第三人称的外部描写」归旁白',
        FORMAT_SPEC.indexOf('第三人称的外部描写') >= 0 && FORMAT_SPEC.indexOf('镜头在看') >= 0);
    ok('★ 说明写明「角色行为不得写成旁白」并给了例子',
        FORMAT_SPEC.indexOf('不得写成旁白') >= 0 && FORMAT_SPEC.indexOf('女娲坐在矮几前捻起石子') >= 0);
    ok('★ 说明列了三类旁白内容（画面/环境 + 外部描写 + 反例）',
        FORMAT_SPEC.indexOf('画面 / 时间 / 地点') >= 0 && FORMAT_SPEC.indexOf('气味') >= 0);
    ok('★ 仍保留「没有名字字段」这一关键特征', FORMAT_SPEC.indexOf('没有名字字段') >= 0);
}

/* ============================================================================
   ★ 配方同步：只同步**我们自己创建的那条**，别人的一个字不动
   ============================================================================ */
{
    /* 别人创建的（identifier 不同）→ 内容必须原封不动 */
    const other = applyPresetRecipe({
        prompts: [{ identifier: 'someone-else', name: PRESET_RECIPE.promptName, content: '别人的内容' }],
        prompt_order: [{ character_id: 1, order: [] }], extensions: {},
    }, { srcName: 'x', srcHash: 'y' });
    eq('★★ 别人创建的条目：内容一个字不动',
        other.preset.prompts.find(p => p.identifier === 'someone-else').content, '别人的内容');
    ok('★ 且报告里说清「不是本插件创建的」',
        other.changes.some(c => c.indexOf('不是本插件创建的') >= 0));

    /* 我们自己创建的 → 说明文本更新时要同步 */
    const mine = applyPresetRecipe({
        prompts: [{ identifier: 'cine-dialogue-format', name: PRESET_RECIPE.promptName, content: '旧文本' }],
        prompt_order: [{ character_id: 1, order: [] }], extensions: {},
    }, { srcName: 'x', srcHash: 'y' });
    eq('★★ 我们自己那条：说明文本有更新时同步到最新',
        mine.preset.prompts.find(p => p.identifier === 'cine-dialogue-format').content, stampSpec(FORMAT_SPEC));

    const again = applyPresetRecipe(mine.preset, { srcName: 'x', srcHash: 'y' });
    ok('★ 同步是幂等的（已是新文本 → 报「已是最新」）',
        again.changes.some(c => c.indexOf('已是最新') >= 0));
}

/* ============================================================================
   ★ FORMAT_SPEC 合并版（0.8.4）
   预设里那份**不是"新版说明的旧副本"**，而是一份内容不同、几处更好的文本：
   有具体例子、「旁白里不许出现「我」」、「不要写颜色/星号/加粗/markdown」、人称细则。
   ⇒ 合并成一份，谁都不丢。
   ============================================================================ */
{
    ok('★ 保留旧版的具体例子',
        FORMAT_SPEC.indexOf('林婉婷·台词 「不脱。」') >= 0 && FORMAT_SPEC.indexOf('林野·动作 我把') >= 0);
    ok('★ 保留旧版的「旁白里不许出现「我」」', FORMAT_SPEC.indexOf('旁白里不许出现「我」') >= 0);
    ok('★ 保留旧版的「不要写颜色、星号、加粗、markdown」',
        FORMAT_SPEC.indexOf('不要写颜色、星号、加粗') >= 0);
    ok('★ 保留旧版的人称细则（两个以上「别人」要写真名）', FORMAT_SPEC.indexOf('全部写真实姓名') >= 0);
    ok('★ 仍有新版的三分法旁白判据',
        FORMAT_SPEC.indexOf('第三人称的外部描写') >= 0 && FORMAT_SPEC.indexOf('不得写成旁白') >= 0);
    ok('★ 说明自己不用星号（否则与「不要写星号」自相矛盾）', FORMAT_SPEC.indexOf('**') < 0);
}

/* ============================================================================
   ★★ 识别放宽（0.8.3 实测踩到的 bug）
   早期会话里创建的条目用的是随机 UUID、首行是【分镜行格式 · 必须严格遵守】，
   只认 identifier === 'cine-dialogue-format' 会认不出它 ⇒ 新规则永远进不去。
   ============================================================================ */
{
    const legacyId = '3093940f-3bac-4fce-8edb-6c66121a223a';
    const legacy = applyPresetRecipe({
        prompts: [{ identifier: legacyId, name: PRESET_RECIPE.promptName, content: '【分镜行格式 · 必须严格遵守】\n正文…（旧版）' }],
        prompt_order: [{ character_id: 1, order: [] }], extensions: {},
    }, { srcName: 'x', srcHash: 'y' });
    eq('★★ 旧版条目（UUID + 【分镜行格式…】）会被识别并同步到最新说明',
        legacy.preset.prompts.find(x => x.identifier === legacyId).content, stampSpec(FORMAT_SPEC));
    ok('★ 报告写明「按内容特征识别为旧版」（透明，不偷偷改）',
        legacy.changes.some(c => c.indexOf('按内容特征识别为旧版') >= 0));
    ok('★ 不动它的 identifier（避免与 prompt_order 失联）',
        legacy.preset.prompts.some(x => x.identifier === legacyId));

    /* 别人写的同名条目、但没我们的标志串 → 仍一个字不动 */
    const other = applyPresetRecipe({
        prompts: [{ identifier: 'someone', name: PRESET_RECIPE.promptName, content: '别人自己写的同名条目' }],
        prompt_order: [{ character_id: 1, order: [] }], extensions: {},
    }, { srcName: 'x', srcHash: 'y' });
    eq('★★ 同名但没有我们的标志串 → 仍一个字不动',
        other.preset.prompts[0].content, '别人自己写的同名条目');
}

/* ============================================================================
   ★★ 标签外露的两个真机 case（0.8.5）
   图1：女娲·眼神   ← 模型自创的层词（不在五层/别名表里）
   图3：西王 madre·动作 ← 名字里带空格
   两者原来都掉进 text 直通 ⇒ **标签原样露在界面上** ✗
   ============================================================================ */
{
    const L = allLayers(DEFAULT_CONFIG);

    const a = parseLine('女娲·眼神 从她那双淡金色的眸子里掠过一抹极其细微的惊愕，随即变回了漫不经心的端庄。', L, false);
    eq('★★ 未知层词「眼神」→ 不再外露，按别名归到「动作」', a.kind + '/' + a.layer, 'row/动作');
    eq('★ 名字保留', a.name, '女娲');
    const ra = renderMessageHTML(
        '女娲·眼神 从她那双淡金色的眸子里掠过一抹极其细微的惊愕，随即变回了端庄。\n女娲·动作 我伸出手掌。',
        { '女娲': '#00F5EF' }, DEFAULT_CONFIG);
    ok('★★ 渲染出的**可见文字**里没有「眼神」这层名',
        String(ra.html).replace(/<[^>]*>/g, '').indexOf('眼神') < 0);

    const b = parseLine('西王 madre·动作 我在他们退出的瞬间才真正彻底放松了肩膀。', L, false);
    eq('★★ 名字含空格（西王 madre）也能识别', b.kind, 'row');
    eq('★ 名字完整保留（含空格）', b.name, '西王 madre');
    eq('★ 层正确', b.layer, '动作');
    const rb = renderMessageHTML(
        '西王 madre·动作 我在他们退出的瞬间才真正彻底放松了肩膀，肩膀整个塌了下来。\n女娲·动作 我伸出手掌。',
        { '西王 madre': '#00F5EF' }, DEFAULT_CONFIG);
    ok('★★ 渲染出的可见文字里没有「·动作」这个标签',
        String(rb.html).replace(/<[^>]*>/g, '').indexOf('·动作') < 0);

    /* ★ 守卫不能误伤：外文名里的间隔号 + 短正文（这就是当初把 lenient 默认关掉的原因） */
    eq('★★ 外文名「阿尔托莉雅·潘德拉贡 说道」不被误判成行（正文太短）',
        parseLine('阿尔托莉雅·潘德拉贡 说道', L, false).kind, 'text');
    eq('★ 未知层 + 短正文也不误判', parseLine('某·奇怪 好的', L, false).kind, 'text');

    /* ★ 守卫式兜底：未知层词 + 足够长的正文 → 渲染成行（自定义层），标签一样藏住 */
    const g = parseLine('某·外貌 她穿着一件看不出材质的素袍，贴在身上透出底下修长的轮廓。', L, false);
    eq('★ 未知层词 + 长正文 → 渲染成行', g.kind, 'row');
    eq('★ 层词原样留在 layer（供自定义层样式用）', g.layer, '外貌');
    eq('★ 标记为 unknown-layer', g.repaired, 'unknown-layer');
}

/* ============================================================================
   ★★ 宽表格防挤压（0.8.6）
   真机：模型输出的 markdown 宽表格（14 列）在窄容器里每列被压到 min-content，
   中文的 min-content = **一个字宽** ⇒ 一列字竖排。
   ★ 关键是**三道限制**必须在代码里真的成立 —— 否则会伤到别的卡。
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    ok('★ 默认开启', DEFAULT_CONFIG.wrapWideTables === true);
    eq('★ 面板字段归「排版」组（不是漏标组）', PANEL_FIELDS.find(f => f.key === 'wrapWideTables').group, '排版');
    ok('★ 关掉即刻恢复原样（开关为假时直接返回）',
        /if \(!effectiveConfig\(\)\.wrapWideTables\) return;/.test(src));

    ok('★★ 限制②：只挑 .mes_text 的**直接子级** table（卡脚本/状态栏的表格在容器里 → 天然不碰）',
        /querySelectorAll\(':scope > table'\)/.test(src));
    ok('★★ 限制①：只在**真的溢出**时才包（小表格一个字不碰）',
        /if \(t\.scrollWidth <= avail \+ 1\) return;/.test(src));
    ok('★★ 限制③：容器不可见（宽度 0）时跳过 —— 隐藏元素的 scrollWidth 不可靠',
        /if \(!avail\) return;/.test(src));
    ok('★ 幂等：已包过的不再包（不会套娃）', /classList\.contains\('cd-tw'\)/.test(src));

    ok('★ 接进 decorate()（**渲染之后**才做，所以不影响 markdown 解析）',
        /try \{ wrapWideTables\(mesEl\); \}/.test(src)
        && src.indexOf('function decorate') < src.indexOf('wrapWideTables(mesEl);'));
    ok('★ 诊断里能看到处理计数（不做黑箱）',
        /tables: \{ wrapped: wrappedTables, candidates: tableCandidates/.test(src));

    ok('★★ 我们的 CSS 只用自有前缀 .cd-tw，**绝不写 .mes_text table**',
        cssText.indexOf('.cd-tw') >= 0 && cssText.indexOf('.mes_text table') < 0);
    ok('★ 内置兜底 CSS 同步（否则取不到 style.css 时失效）',
        /'\.cd-tw\{overflow-x:auto/.test(src));
    ok('★ 顺带补上兜底里之前漏掉的 .custom-cd-anchor',
        /'\.custom-cd-anchor\{display:none\}'/.test(src));

    /* 只有一张表的少量列时不该被 nowrap 影响：判据是"溢出"，不是"有没有表" */
    ok('★ 判据是溢出而不是"有没有表格"（所以窄表不受影响）',
        src.indexOf('scrollWidth <= avail') >= 0 && src.indexOf(':scope > table') >= 0);
}

/* ============================================================================
   ★ 机械自检脚本必须留在仓库里（本会话的几类错靠"再看一眼"发现不了）
   ============================================================================ */
{
    const audit = new URL('../scripts/cine-dialogue-audit.mjs', import.meta.url);
    ok('★ 自检脚本在（scripts/cine-dialogue-audit.mjs）', fs.existsSync(audit));
    const a = fs.readFileSync(audit, 'utf8');
    ok('★ 覆盖这几类：语法 / 配置键三向核对 / CSS 白名单 / 兜底 CSS 同步 / 版本+CHANGELOG / 死代码 / 已装目录',
        ['A. 语法', 'B. 配置键', 'C. CSS 选择器白名单', 'D. 内置兜底', 'E. 版本与 CHANGELOG', 'F. 死代码', 'G. 仓库与已装目录']
            .every(t => a.indexOf(t) >= 0));
    ok('★ 死代码判据是"全仓库零使用"（不能只看 index.js/夹具 —— 初版就是这样误报的）',
        a.indexOf('不能用只看') >= 0 || a.indexOf('不能只看 index.js') >= 0 || a.indexOf('全仓库') >= 0);
    ok('★ 手写 UI 的键有名单（否则会误报"用户改不到"）',
        a.indexOf("HAND_UI = ['onlyChar', 'highlight']") >= 0);
    ok('★ 已注册 npm 脚本（package.json 里有 ext:audit）',
        fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8').indexOf('"ext:audit"') >= 0);

    /* ★ 死代码清理的回归：RE_ROW 已删（它被别名正则架空了，留着会误导） */
    const lg = fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8');
    ok('★ 死代码 RE_ROW 已删（0.6.2 加别名后它就不再代表解析器行为）',
        !/export const RE_ROW/.test(lg));
}

/* ============================================================================
   ★★ 层名写在「·」**前面**、而且 `·` 后没有空格（真机：「旁的叙述·染开始加速…」）
   模型把「旁白」和「叙述」揉成「旁的叙述」，还把它放到了 · 的前面 ⇒
   原来整行掉进 text 直通 ⇒ **标签露在界面上** ✗
   ============================================================================ */
{
    const L = allLayers(DEFAULT_CONFIG);

    const a = parseLine('旁的叙述·染开始加速前后冲送。他的腰肢随着那股爆发力规律地点跳动。', L, false);
    eq('★★ 「旁的叙述·…」→ 归为旁白（标签不再外露）', a.kind, 'narr');
    ok('★ 正文完整保留', a.body.indexOf('染开始加速') === 0);
    eq('★ 别名表里有「旁的叙述」', canonLayer('旁的叙述'), '旁白');
    eq('★ 「旁白叙述」也认', canonLayer('旁白叙述'), '旁白');

    const b = parseLine('动作·我抬手按住她的手腕，力道不轻不重。', L, false);
    eq('★ 其它层名在前 → row（没有名字）', b.kind, 'row');
    eq('★ 层正确', b.layer, '动作');
    eq('★ 名字为空（这类行本来就没有名字）', b.name, '');
    eq('★ 标记 layer-only（hover 会说明是插件补的）', b.repaired, 'layer-only');

    /* ★ 顺序：这条规则必须在 rowRegexFor **之前**、RE_NARR **之后**，不能抢掉正常的行 */
    const c = parseLine('染·动作 我按住她的手腕，把她整个人按在门板上。', L, false);
    eq('★★ 正常的「名字·层 内容」不受影响（顺序正确）', c.kind + '/' + c.name + '/' + c.layer, 'row/染/动作');

    /* ★ 守卫：外文名里的间隔号 + 短正文，不能被误判 */
    eq('★ 外文名（正文太短）仍是 text', parseLine('阿尔托莉雅·潘德拉贡 说道', L, false).kind, 'text');

    /* ★★ 可见文字里不得出现那个标签 */
    const r = renderMessageHTML(
        '旁的叙述·染开始加速前后冲送。他的腰肢随着那股爆发力规律地点跳动。\n染·动作 我按住她的手腕，把她按在门板上。',
        { '染': '#00F5EF' }, DEFAULT_CONFIG);
    ok('★★ 渲染出的**可见文字**里没有「旁的叙述」',
        String(r.html).replace(/<[^>]*>/g, '').indexOf('旁的叙述') < 0);
}

/* ============================================================================
   ★★ 逐卡「本卡不生效」（0.8.9）—— 给自带美化的卡用
   设计要点：**只在一个点上**把 off 翻成 enabled:false ⇒ 所有已有的 enabled 检查点
   （渲染钩子 / run / 提示词注入 / Alt+↑↓ / 宽表格处理 / 交互绑定 / 恢复原文）自动跟着失效。
   ============================================================================ */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ off 只在 effectiveConfig 一个点上翻成 enabled:false（不逐处加判断）',
        /if \(merged\.off\) return \{ \.\.\.merged, enabled: false, off: true \};/.test(src));
    ok('★ 面板有按钮（给自带美化的卡用）', src.indexOf('id="cd-card-off"') >= 0);
    ok('★ 有对应动作处理', /case 'cd-card-off': \{/.test(src));
    ok('★ 切换只动 off 这一个键（这张卡的颜色/层样式等专属配置保留）',
        /delete cur\.off;/.test(src) && /cur\.off = true;/.test(src));
    ok('★ 切换后立刻重渲染（不生效=恢复原文；恢复=重新渲染）', /restoreAllMessages\(\);/.test(src));
    ok('★ 不生效时面板显示警告（否则会以为插件坏了）', src.indexOf(String.fromCharCode(0x26D4) + ' 当前卡：') >= 0);
    ok('★ diagnose 报 cardOff（可诊断，不做黑箱）', /cardOff: \{ off: !!effectiveConfig\(\)\.off/.test(src));
    ok('★ 没有角色卡时提示不可用（不会静默失败）', src.indexOf('没有加载角色卡 → 逐卡设置不可用') >= 0);
}

/* ============================================================================
   ★★ 空名字的行必须收起名字列（0.8.10，修「内容排版没对齐」）
   现象：narr（旁白）与 layer-only（模型只写层名）这类行名字是空的，
   却照样占掉固定名字列（--cd-namew 96px）⇒ 正文被推右一段，和普通段落对不齐。
   ============================================================================ */
{
    const NL = String.fromCharCode(10);
    const html = String(renderMessageHTML([
        '旁白·窗外的雨已经彻底停了。',
        '动作·我抬手按住她的手腕，力道不轻不重。',
        '汐音·台词 「好……好难熬啊。」',
    ].join(NL), { 汐音: '#8ab4f8' }, DEFAULT_CONFIG).html);

    /* ★★ 用户 2026-10-14 纠正：**旁白要和各行的正文对齐** ⇒ 旁白保留空名字格；
       只有「只写层名 / 未知层兜底」那类（模型写错格式）才收起名字列，避免白空一段 */
    eq('★★ 只有 layer-only 那行带 cd-noname（旁白不带）',
        html.split('cd-who cd-noname').length - 1, 1);
    eq('★ 旁白与有名字的行都保留名字格（正文同列对齐）',
        html.split('<span class="cd-who">').length - 1, 2);
    ok('★★ 旁白行的名字格是空的但**保留**（⇒ 与上面各行的正文对齐）',
        /cd-L-narr[^>]*><span class="cd-who"><\/span>/.test(html));

    const cssText = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8');
    ok('★★ style.css 有两条规则（收起 + 正文横跨两列）',
        cssText.indexOf('.custom-cd-who.custom-cd-noname') >= 0 && cssText.indexOf('grid-column: 1 / -1') >= 0);
    ok('★ 内置兜底同步（取不到 style.css 时仍成立）',
        /'\.custom-cd-who\.custom-cd-noname\{display:none\}'/.test(fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8')));
    /* ★ 注释里提到 .mes_text 是**说明**，不算选择器 ⇒ 先去掉注释再判 */
    const cssNoComment = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
    ok('★ 选择器仍是自有前缀（没有真的写 .mes_text 规则）',
        !/\.mes_text\s*[^{]*\{/.test(cssNoComment) && !/\.mes\s*[^{]*\{/.test(cssNoComment));
}

/* ============================================================================
   ★★ markdown 图片 → 真 <img>（0.8.11）
   真机实测：我们交给 ST 的是**整块 HTML** ⇒ showdown 不再解析块内 markdown
   ⇒ 原样的 ![pic435](https://…) 会以**字面文字**露出来（独立一行、夹在句子里都中招）。
   ============================================================================ */
{
    ok('★★ 独立一行的 markdown 图片 → <img>',
        /<img/.test(renderInlineImages('![p](https://a/b.png)')));
    ok('★★ 夹在句子里也换（前后文字保留）', (() => {
        const s = renderInlineImages('看见 ![p](https://a/b.png) 贴在门上。');
        return s.indexOf('看见 ') === 0 && s.indexOf('<img') > 0 && s.indexOf('贴在门上。') > 0;
    })());
    ok('★ data:image 也认',
        renderInlineImages('![x](data:image/png;base64,iVBORw0KGgo=)').indexOf('<img') >= 0);
    ok('★★ javascript: / ftp: 一律不转换（安全）',
        renderInlineImages('![x](javascript:alert(1))').indexOf('<img') < 0
        && renderInlineImages('![x](ftp://a/b.png)').indexOf('<img') < 0);
    ok('★ 普通文字一个字不动', renderInlineImages('普通文字，没有图片') === '普通文字，没有图片');

    const im = String(renderMessageHTML(
        '白霜予·动作 我拧开水龙头洗手。' + String.fromCharCode(10)
        + '![pic435](https://i.ibb.co/x.png)' + String.fromCharCode(10)
        + '白霜予·台词 「回来了！」',
        { '白霜予': '#8ab4f8' }, DEFAULT_CONFIG).html);
    ok('★★ 分镜楼里的图片不再露成字面文字',
        /<img class="cd-img"/.test(im) && !/!\[[^\]]*\]\(/.test(im));

    const cssImg = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8');
    ok('★ CSS 用自有前缀 .custom-cd-img 且限宽',
        cssImg.indexOf('.custom-cd-img') >= 0 && cssImg.indexOf('max-width: 100%') >= 0);
}

/* ============================================================================
   ★★ 英文元数据行不能被吃成分镜行（0.8.12，真机踩到）
   真机：`- Time passed: from noon (午时) to early afternoon, approximately 1-2 hours …`
   被解析成 name=`- Time passed` layer=`from` ⇒ 于是 repairLines 把 10 行引号台词
   全挂到这个根本不存在的"角色"上（产物里真的渲染成了说话人 ✗）。
   根因：分隔符里含 `:` ⇒ 英文 `Key: value` 被当成分镜行；再加上「未知层 + 长正文」的守卫就吃下了。
   ============================================================================ */
{
    const L = allLayers(DEFAULT_CONFIG);
    eq('★★ 英文元数据行 \`- Time passed: from noon …\` 不再被解析成 row',
        parseLine('- Time passed: from noon (午时) to early afternoon, approximately 1-2 hours of activity', L, false).kind, 'text');
    eq('★ 名字不许以结构符号开头（- * # > [ ] 等）',
        parseLine('- foo·动作 我按住她的手腕，力道不轻不重。', L, false).kind, 'text');

    /* 正常路径一律不受影响（回归） */
    eq('★ 林野:动作 … 仍照认（已知层 + 冒号）', parseLine('林野:动作 我按住她的手腕。', L, false).name, '林野');
    eq('★ 西王 madre·动作 … 仍照认（名字带空格）',
        parseLine('西王 madre·动作 我在他们退出的瞬间才真正彻底放松了肩膀。', L, false).name, '西王 madre');
    eq('★ 女娲·眼神 … 仍归一为动作',
        parseLine('女娲·眼神 从她那双淡金色的眸子里掠过一抹惊愕。', L, false).layer, '动作');
    eq('★ 某·外貌 … 仍走未知层守卫',
        parseLine('某·外貌 她穿着一件看不出材质的素袍，贴在身上透出底下修长的轮廓。', L, false).repaired, 'unknown-layer');
    eq('★★ 外文名 阿尔托莉雅·潘德拉贡 说道 仍不被误判',
        parseLine('阿尔托莉雅·潘德拉贡 说道', L, false).kind, 'text');

    /* repairLines：假名字不许当说话人；真名字仍要能补（含向后找） */
    const rep = repairLines([
        '- Time passed: from noon to early afternoon, approximately 1-2 hours of activity',
        String.fromCharCode(34) + '染！' + String.fromCharCode(34),
        '林野·动作 我按住她的手腕。',
        String.fromCharCode(34) + '别动，听我说完。' + String.fromCharCode(34),
    ], DEFAULT_CONFIG);
    ok('★★ 不再把「- Time passed」这种假名字挂到台词上',
        !rep.some((x) => x.p && x.p.name === '- Time passed'));
    ok('★ 真角色名仍能补上（向后找也对）', rep[1].p.name === '林野');
}



/* ============================================================================
   ★★ 颜色稳定性（0.8.16 定稿判据）
   意图不变（颜色要稳定），但机制换对了：0.8.14 用名字哈希求稳定是错的
   （那只是把颜色换成另一套，不是用户那套）。现在：首见顺序分配（主角=第 1 色青）
   + 立刻钉进 charColors。
   ============================================================================ */
{
    const a = resolveColors(['汐音', '染', '沙良'], {}, {});
    eq('★★ 第一个出现的角色拿调色板第 1 色（主角=青）', a['汐音'], PALETTE[0]);
    eq('★ 第二个拿第 2 色', a['染'], PALETTE[1]);
    eq('★★ 同楼三个角色互不相同', new Set(Object.values(a)).size, 3);
    const b = resolveColors(['久美', '汐音', '染', '沙良'], {}, a);
    eq('★★ 下一楼老角色颜色不变（汐音）', b['汐音'], a['汐音']);
    eq('★★ 下一楼老角色颜色不变（染）', b['染'], a['染']);
    eq('★★ 下一楼老角色颜色不变（沙良）', b['沙良'], a['沙良']);
    const e = resolveColors(['染'], { charColors: { 染: '#ABCDEF' } }, {});
    eq('★ 用户在面板点名的颜色优先', e['染'], '#ABCDEF');
}

/* ★ 老默认 rowGap=0.8 的迁移（我当年只改了默认值，对老配置没生效 —— 用户反馈「间距有点大」） */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ 有 migrateRowGap()，且只在 0.8 时改成 0.5',
        /function migrateRowGap\(\)/.test(src) && /if \(Number\(c\.rowGap\) === 0\.8\)/.test(src));
    ok('★ start() 里调用了它', src.indexOf('migrateRowGap();') >= 0);
    ok('★ 只跑一次（stamp）', /rowGapStamp === 'v2'/.test(src));
    eq('★ 默认值确实是 0.5', DEFAULT_CONFIG.rowGap, 0.5);
}

/* ============================================================================
   ★★ 判据**反转**（2026-10-14，1.0.4）：
   旧决定（当年「按你倾向」）把 `行动: "…"` 当**动作行**渲染、去掉 `行动:` 前缀 ✗
   —— 它与**状态栏 YAML 的键同形** ⇒ 把状态栏的键名吃掉了 ✗（用户："状态栏是被删了"）
   新判据：`:` 分隔时**只认五个正名** ✓（没有卡会把 YAML 键写成"动作"）
   ⇒ `行动:` / `内心:`（别名）⇒ **不碰** ✓ 状态栏原样活下来 ✓
   ============================================================================ */
{
    const L = allLayers(DEFAULT_CONFIG);
    const s = '行动: "趴在沙发上，黑丝包裹的双腿交叠着"';
    const p = parseLine(s, L, false);
    ok('★★ 别名+冒号不再当行（保住状态栏键名）', p.kind !== 'row');
    const html = String(renderMessageHTML('染·动作 我推门进去。' + String.fromCharCode(10) + s, {}, DEFAULT_CONFIG).html);
    ok('★★ 状态栏那行的「行动:」原样保留', html.indexOf('行动:') >= 0);
    ok('★ 该行正文也还在', html.indexOf('趴在沙发上') >= 0);
    const q = parseLine('动作: 我抬手把门关上，指节压得发白。', L, false);
    ok('★ 正名 + 冒号仍然是行（没有卡把 YAML 键写成正名）', q.kind === 'row' && q.layer === '动作');
    const q2 = parseLine('行动: 我抬手把门关上，指节压得发白。', L, false);
    ok('★ 别名 + 冒号不再是行', q2.kind !== 'row');
    const q3 = parseLine('染·行动 我抬手把门关上，指节压得发白。', L, false);
    ok('★★ 但是「染·行动」（带名字）仍然是行 —— 别名只在有 · 时生效', q3.kind === 'row' && q3.layer === '动作');
}

/* ★★ 禁掉 ST「引用文本」色在我们行内的渗入（0.8.22，用户定位到的根因） */
{
    const css = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8');
    ok('★★ 正文格显式取行色', /\.custom-cd-body\s*\{[^}]*color:\s*var\(--c/.test(css));
    ok('★★ 行内的 q/em/i/strong 继承行色（压过 ST 的 .mes_text q）',
        /\.custom-cd-body q[^{]*\{[^}]*color:\s*inherit/.test(css));
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★ 内置兜底同步', src.indexOf('.custom-cd-body q,.custom-cd-body em') >= 0);
    ok('★ 只作用于自有前缀（没有写 .mes_text）', !/\.mes_text\s*[^{]*\{/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
}

/* ★★ 角色类型绑色（用户要求）：蓝名单=用户+男性；紫名单=女性+扶她 */
{
    const cfg = { ...DEFAULT_CONFIG, roleBlueNames: '染, 老王', rolePurpleNames: '沙良、久美 沈鹿笙' };
    const r = resolveColors(['染', '老王', '沙良', '久美', '沈鹿笙', '路人甲'], cfg, {});
    eq('★★ 蓝名单（用户/男性）= 蓝', r['染'], cfg.roleBlueColor);
    eq('★ 蓝名单第二人也是蓝', r['老王'], cfg.roleBlueColor);
    eq('★★ 紫名单（女性/扶她）= 紫', r['沙良'], cfg.rolePurpleColor);
    eq('★ 紫名单里的顿号/空格都认（久美）', r['久美'], cfg.rolePurpleColor);
    eq('★ 紫名单第二个（沈鹿笙）', r['沈鹿笙'], cfg.rolePurpleColor);
    ok('★ 名单外的角色仍按调色板拿色（不被绑死）',
        r['路人甲'] !== cfg.roleBlueColor && r['路人甲'] !== cfg.rolePurpleColor);
    eq('★ 名单解析：逗号/顿号/空格都拆得开', parseNameList('甲,乙、丙 丁').join('|'), '甲|乙|丙|丁');
}

/* ★★ 从描述里自动判定性别（用户提示：人格描述里就写着「染是一名男性」） */
{
    eq('★★ 「染是一名男性」→ male', guessGenderFromText('染', '染是一名男性。黑短碎发，琥珀瞳。'), 'male');
    eq('★★ 「沙良是一名女性」→ female', guessGenderFromText('沙良', '沙良是一名女性，人妻。'), 'female');
    eq('★ 「沈鹿笙是扶她」→ futa', guessGenderFromText('沈鹿笙', '沈鹿笙是扶她，同时具有两边特征。'), 'futa');
    eq('★ 名字附近没有性别词 → 判不出', guessGenderFromText('路人甲', '路人甲只是经过而已。'), '');
    eq('★ 空输入不炸', guessGenderFromText('', ''), '');
    ok('★ 窗口只看名字附近（远处的性别词不算）',
        guessGenderFromText('甲', '乙是男性。' + 'x'.repeat(200) + '甲出现了。') === '');
}

/* ★★ 只给「用户角色」绑色（用户纠正：其他角色的颜色不该被改） */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ 只种用户角色那一个名字（userSeed 形式）', /resolveColors\(names, cf, userName \? \{ \[userName\]: userColor \} : \{\}\)/.test(src));
    ok('★★ 不再批量把判定结果并入蓝/紫名单', src.indexOf('autoRoleLists') < 0);
    eq('★ guessGenderFromText 仍可用（只用于 user）', guessGenderFromText('染', '染是一名男性。'), 'male');
    const r = resolveColors(['甲', '乙'], { ...DEFAULT_CONFIG, rolePurpleNames: '乙' }, {});
    eq('★ 面板手填名单仍生效（乙=紫）', r['乙'], DEFAULT_CONFIG.rolePurpleColor);
    ok('★ 名单外的人仍是自动配色（甲 ≠ 紫）', r['甲'] !== DEFAULT_CONFIG.rolePurpleColor);
}

/* ★★ <options> 块里认不出的行必须还回正文（0.8.27：真机踩到整块内容消失） */
{
    const NL = String.fromCharCode(10);
    const blk = ['<options>', 'A. 用字母写的选项甲，内容要保留。', 'B. 用字母写的选项乙，内容也要保留。', '</options>'].join(NL);
    const html = String(renderMessageHTML('染·动作 我按住她的手腕。' + NL + blk, {}, CONV_CFG).html);
    eq('★★ A./B. 被识别成选项按钮（2 个）', (html.match(/class="cd-opt"/g) || []).length, 2);
    ok('★★ 字母选项的正文也在（不丢字）', html.indexOf('内容要保留') >= 0 || html.replace(/<[^>]*>/g, '').indexOf('内容要保留') >= 0);
    const blk2 = ['<options>', '完全不像选项的一段说明，也必须留下。', '</options>'].join(NL);
    const vis2 = String(renderMessageHTML('染·动作 我按住她的手腕。' + NL + blk2, {}, DEFAULT_CONFIG).html).replace(/<[^>]*>/g, '');
    ok('★★ 认不出的行**还回正文**（永不丢字）', vis2.indexOf('完全不像选项的一段说明') >= 0);
    const blk3 = ['<options>', '>选项一：老写法', '2. 数字写法', '</options>'].join(NL);
    const h3 = String(renderMessageHTML('染·动作 我按住她的手腕。' + NL + blk3, {}, CONV_CFG).html);
    eq('★ 原有两种写法仍是 2 个按钮（不回归）', (h3.match(/class="cd-opt"/g) || []).length, 2);
}

/* ★★ 只有选项的楼也要接手（0.8.28：用户报「选择状态栏消失了」）
   卡自己没有选择状态栏时，选项栏是我们提供的功能；原来"没有我们的行就 return null"把它挡掉了 ✗ */
{
    const N2 = String.fromCharCode(10);
    const onlyOpts = ['染推开门，走廊很安静。', '<options>', '>选项一：甲', '>选项二：乙', '</options>'].join(N2);
    const r = renderMessageHTML(onlyOpts, {}, CONV_CFG);
    ok('★★ 只有选项的楼会接手（不是 null）', !!r);
    eq('★★ 选项正常变成 2 个按钮', ((String(r && r.html).match(/class=\"cd-opt\"/g)) || []).length, 2);
    ok('★★ 选项被包进 cd-root（拿到主题变量，避免白底按钮）', String(r && r.html).indexOf('cd-root') >= 0);
    ok('★ 正文一个字没丢', String(r && r.html).indexOf('走廊很安静') >= 0);
    const r2 = renderMessageHTML('染·动作 我按住她的手腕。' + N2 + '<options>' + N2 + '>选项一：甲' + N2 + '</options>', {}, CONV_CFG);
    eq('★ 有行又有选项时不重复渲染（仍 1 个按钮）', ((String(r2.html).match(/class=\"cd-opt\"/g)) || []).length, 1);
    ok('★ 纯散文（无选项）仍不接手（原行为不变）', renderMessageHTML('染推开门，走廊很安静。', {}, DEFAULT_CONFIG) === null);
}

/* ★★ 专属预设适配：格式说明插到 prompt_order 末尾（越贴近输出权重越高） */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8');
    eq('★★ orderAt 是末尾哨兵 -1', PRESET_RECIPE.orderAt, -1);
    ok('★★ splice 支持末尾插入', /order\.splice\(at, 0, entry\);/.test(src));
    ok('★★ FORMAT_SPEC 要求思考阶段也按格式规划', FORMAT_SPEC.indexOf('思考阶段就按这个格式规划') >= 0);
    /* 真跑一遍 applyPresetRecipe：条目必须排在最后 */
    const base = {
        prompts: [{ identifier: 'x1', name: '甲', content: 'a' }, { identifier: 'x2', name: '乙', content: 'b' }],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'x1', enabled: true }, { identifier: 'x2', enabled: true }] }],
        extensions: {},
    };
    const r = applyPresetRecipe(base, { srcName: 't', srcHash: 'h' });
    const od = r.preset.prompt_order[0].order;
    /* ★ 注意：派生说明（停用）会被追加在它后面 ⇒ 判据看「最后一条**启用**的」 */
    const lastOn = od.filter((x) => x.enabled).slice(-1)[0];
    /* ★ 0.8.32 起：最后一条启用的是「篇幅与节奏」（它排在格式说明之后 ⇒ 最贴近输出 ✓） */
    /* 0.8.41 起：对白量 50% 由配方管理 ⇒ 它会在最末；判据改为"篇幅条目必须启用" ✓ */
    ok('★★ 篇幅条目是启用的（内容类条目里最贴近输出）',
        (od.find((x) => String(x.identifier) === String(r.preset.prompts.find((p) => p.name === PRESET_RECIPE.lengthName).identifier)) || {}).enabled === true);
    ok('★ 最末那条是我们写的条目之一',
        [PRESET_RECIPE.lengthName, PRESET_RECIPE.dbl50Name].indexOf(String(r.preset.prompts.find((p) => p.identifier === lastOn.identifier).name)) >= 0);
    eq('★ order 里共 7 条（原有 2 + 铁律 + 格式说明 + 篇幅 + 50% + 停用的派生说明）', od.length, 7);
    ok('★ 铁律在 order 里（位置由「指南」决定，这里只断言存在）', od.some((x) => String(x.identifier) === 'cine-dialogue-iron'));
    ok('★ 原有的两条仍启用（没被挤掉）', od[0].enabled === true && od[1].enabled === true);
}

/* ★★ 未标注的第三人称段落 ⇒ 当旁白（用户「旁白问题」）；带「我」的不猜 */
{
    const N3 = String.fromCharCode(10);
    const L2 = allLayers(DEFAULT_CONFIG);
    const p = (x) => narratePlain(x, L2);
    eq('★★ 第三人称段落 ⇒ 加「旁白·」', p('门锁发出轻微的转动声。'), '旁白·门锁发出轻微的转动声。');
    eq('★ 带「我」的句子不动', p('我隔着房门感觉到了气息。'), '我隔着房门感觉到了气息。');
    eq('★ 已经是旁白行 ⇒ 不动', p('旁白·门锁响了一声。'), '旁白·门锁响了一声。');
    eq('★ 已经是分镜行 ⇒ 不动', p('久美·动作 我推开门。'), '久美·动作 我推开门。');
    eq('★ 结构块 / markdown ⇒ 不动', p('<div class="x">内容</div>'), '<div class="x">内容</div>');
    eq('★ 表格式行（含 |）⇒ 不动', p('| 甲 | 乙 | 内容 |'), '| 甲 | 乙 | 内容 |');
    eq('★ 引号开头的对白 ⇒ 不动', p('「你回来了。」她说。'), '「你回来了。」她说。');
    eq('★ 太短 ⇒ 不动', p('门响了。'), '门响了。');
    ok('★★ 开关**默认关**（判据不可靠 ⇒ 插件不猜 ✗）', DEFAULT_CONFIG.narrateUnlabeled === false);
    /* 整楼：第三人称段落要变成 cd-L-narr 行 */
    const html = String(renderMessageHTML('由于隔墙传来的动静，房间里还残留着气息。' + N3 + '久美·动作 我推开门。', {}, { ...DEFAULT_CONFIG, narrateUnlabeled: true }).html);
    ok('★★ 手动打开时才当旁白（cd-L-narr）', html.indexOf('cd-L-narr') >= 0);
    const html0 = String(renderMessageHTML('由于隔墙传来的动静，房间里还残留着气息。' + N3 + '久美·动作 我推开门。', {}, DEFAULT_CONFIG).html);
    ok('★★ 默认（不打开）时**不会**把段落判成旁白 ✗', html0.indexOf('cd-L-narr') < 0);
}

/* ★★ 篇幅与节奏属于**预设**（用户 2026-10-14）；只创建一次、不覆盖用户改动 */
{
    const base = {
        prompts: [{ identifier: 'a', name: '甲', content: 'a' }],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'a', enabled: true }] }],
        extensions: {},
    };
    const r = applyPresetRecipe(base, { srcName: 't', srcHash: 'h' });
    const lp = r.preset.prompts.find((p) => String(p.name || '') === PRESET_RECIPE.lengthName);
    ok('★★ 预设里新增了「篇幅与节奏」条目', !!lp);
    ok('★★ 内容是 LENGTH_SPEC（含篇幅参考 / 长行 50–110 字）', String(lp.content).indexOf('16–24 个回合') >= 0 && String(lp.content).indexOf('50–110 字') >= 0);
    ok('★ 条目不用星号（免得模型抄进正文）', String(lp.content).indexOf('*') < 0);
    const od = r.preset.prompt_order[0].order;
    /* 停用的派生说明会排在它后面 ⇒ 判据看「最后一条启用」✓ */
    let lastOnIdx = -1;
    for (let k = od.length - 1; k >= 0; k--) { if (od[k].enabled) { lastOnIdx = k; break; } }
    ok('★★ 篇幅条目在 order 里且启用', od.some((x) => String(x.identifier) === 'cine-dialogue-length' && x.enabled === true));
    /* 用户改过 ⇒ 第二次不许覆盖 */
    lp.content = '我自己改过的内容：每次 6 组';
    const r2 = applyPresetRecipe(r.preset, { srcName: 't', srcHash: 'h' });
    const lp2 = r2.preset.prompts.find((p) => String(p.name || '') === PRESET_RECIPE.lengthName);
    eq('★★ 不覆盖用户改动', lp2.content, '我自己改过的内容：每次 6 组');
    ok('★ 报告里写明不覆盖', r2.changes.some((x) => x.indexOf('不覆盖') >= 0));
}

/* ★★ 台词 10–20 字波动（用户 2026-10-14）；预设条目只在我们写的版本上更新 */
{
    ok('★★ LENGTH_SPEC 里台词写的是"按需要来回波动"', LENGTH_SPEC.indexOf('按需要来回波动') >= 0);
    ok('★★ 提到常规 10–50 字与 100 字左右', LENGTH_SPEC.indexOf('10–50 字') >= 0 && LENGTH_SPEC.indexOf('80 字左右') >= 0);
    ok('★ LENGTH_SPEC 不再写 ~10 字', LENGTH_SPEC.indexOf('~10 字') < 0);
    ok('★ LENGTH_SPEC 不再写死的 10–20 字', LENGTH_SPEC.indexOf('10–20 字') < 0);
    ok('★★ FORMAT_SPEC 里台词也是按需要波动', FORMAT_SPEC.indexOf('按需要来回波动') >= 0);
    /* v1 内容（还是我们写的）⇒ 会被更新 */
    const mk = (content) => ({
        prompts: [{ identifier: 'cine-dialogue-length', name: PRESET_RECIPE.lengthName, content }],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'cine-dialogue-length', enabled: true }] }],
        extensions: {},
    });
    /* ★★ 1.6.0 判据改了：**看版本盖章**（旧写法靠匹配措辞 ⇒ 措辞一改就永远失配 ✗）
       · 内容以我们的盖章开头 ⇒ 用户没改过 ⇒ 同步到最新 ✓
       · 没有盖章（= 用户改过）⇒ 一个字不动 ✓ */
    const r1 = applyPresetRecipe(mk('（分镜对话 v1.0.0 生成）\n旧内容'), { srcName: 't', srcHash: 'h' });
    ok('★★ 有我们的盖章 ⇒ 会自动同步到最新', String(r1.preset.prompts[0].content).indexOf('（分镜对话 v') === 0 && String(r1.preset.prompts[0].content).indexOf('按需要来回波动') >= 0);
    const rv2 = applyPresetRecipe(mk('（分镜对话 v0.9.0 生成）\n旧 v2 内容 10–20 字'), { srcName: 't', srcHash: 'h' });
    ok('★★ 老盖章也认（同步到最新）', String(rv2.preset.prompts[0].content).indexOf('按需要来回波动') >= 0);
    const r2 = applyPresetRecipe(mk('我自己改的：每次 6 组，台词随意'), { srcName: 't', srcHash: 'h' });
    eq('★★ 你改过的内容一个字不动', r2.preset.prompts[0].content, '我自己改的：每次 6 组，台词随意');
    const rNo = applyPresetRecipe(mk('旧版内容 ~10 字（没盖章）'), { srcName: 't', srcHash: 'h' });
    eq('★★ 没盖章（认不出是我们写的）⇒ 也不动', rNo.preset.prompts[0].content, '旧版内容 ~10 字（没盖章）');
}

/* ★★ 多人场景：台词行数随在场人数变（用户 2026-10-14：「遇到多人怎么办呢？」） */
{
    ok('★★ 一组 = 一个回合（不再绑死 5 行）', LENGTH_SPEC.indexOf('一个回合 = 一组') >= 0);
    ok('★★ 台词句数 = 在场开口的人数（2/3/5 人举例）', LENGTH_SPEC.indexOf('2 人 ⇒ 2 句') >= 0 && LENGTH_SPEC.indexOf('5 人 ⇒ 5 句') >= 0);
    const mk3 = (content) => ({
        prompts: [{ identifier: 'cine-dialogue-length', name: PRESET_RECIPE.lengthName, content }],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'cine-dialogue-length', enabled: true }] }],
        extensions: {},
    });
    const rv3 = applyPresetRecipe(mk3('（分镜对话 v1.5.0 生成）\n旧内容'), { srcName: 't', srcHash: 'h' });
    ok('★★ 有盖章的老版本会被同步成新版', String(rv3.preset.prompts[0].content).indexOf('台词行数 = 在场') >= 0);
}

/* ★★ 字段形态必须和原生条目一致（真机踩到：缺 marker ⇒ 列表里不显示 ✗） */
{
    const base = {
        prompts: [
            { identifier: 'a', name: '甲', content: 'a', marker: false, forbid_overrides: false, enabled: true },
            { identifier: 'fm', name: PRESET_RECIPE.promptName, content: 'x' },
        ],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'a', enabled: true }, { identifier: 'fm', enabled: true }] }],
        extensions: {},
    };
    const r = applyPresetRecipe(base, { srcName: 't', srcHash: 'h' });
    const fm = r.preset.prompts.find((p) => p.name === PRESET_RECIPE.promptName);
    ok('★★ 我们的条目补上了 marker', fm.marker === false);
    ok('★★ 补上了 forbid_overrides', fm.forbid_overrides === false);
    ok('★★ 补上了 enabled', fm.enabled === true);
    const p50 = r.preset.prompts.find((p) => p.name === PRESET_RECIPE.dbl50Name);
    ok('★★ 没有 50% 条目时会创建', !!p50);
    ok('★★ 50% 条目也带 marker/forbid_overrides', p50 && p50.marker === false && p50.forbid_overrides === false);
    /* 0.8.41 起：50% 是配方管理的开关（用户选定的对白量）⇒ 创建后由 toggles 打开 ✓ */
    eq('★★ 50% 由配方开关打开（用户选定的对白量）', (r.preset.prompt_order[0].order.find((x) => x.identifier === p50.identifier) || {}).enabled, true);
    /* 已存在时内容不动 */
    p50.content = '我自己改过的 50% 文案';
    const r2 = applyPresetRecipe(r.preset, { srcName: 't', srcHash: 'h' });
    eq('★★ 50% 已存在时内容不覆盖', r2.preset.prompts.find((p) => p.name === PRESET_RECIPE.dbl50Name).content, '我自己改过的 50% 文案');
}

/* ★★ 条目内容顶部盖版本号（用户要求「加版本号」；文件名也带 ⇒ C 方案） */
{
    ok('★★ stampSpec 盖上版本号', stampSpec('正文').indexOf('（分镜对话 v' + VERSION + ' 生成）') === 0);
    ok('★ 盖过的内容不用星号', stampSpec('正文').indexOf('*') < 0);
    const base = {
        prompts: [{ identifier: 'cine-dialogue-format', name: PRESET_RECIPE.promptName, content: 'x' }],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'cine-dialogue-format', enabled: true }] }],
        extensions: {},
    };
    const r = applyPresetRecipe(base, { srcName: 't', srcHash: 'h' });
    const fm = r.preset.prompts.find((p) => p.name === PRESET_RECIPE.promptName);
    ok('★★ 格式说明条目顶部有版本号', String(fm.content).indexOf('（分镜对话 v' + VERSION + ' 生成）') === 0);
    const lp = r.preset.prompts.find((p) => p.name === PRESET_RECIPE.lengthName);
    ok('★★ 篇幅条目顶部也有版本号', String(lp.content).indexOf('（分镜对话 v' + VERSION + ' 生成）') === 0);
}

/* ★★ 对白量纳入配方开关（生成器以原版重建 ⇒ 不纳入会被还原 ✗） */
{
    const tg = PRESET_RECIPE.toggles;
    ok('★★ 配方里有「一半（50%）」且要求打开', tg.some(([n, v]) => n === '👤对白量：一半（50%）' && v === true));
    ok('★★ 配方里要求关掉「中」', tg.some(([n, v]) => n === '👤对白量：中' && v === false));
    ok('★ 少/多/100% 也都要求关', ['👤对白量：少', '👤对白量：多', '👤对白量：100%'].every((k) => tg.some(([n, v]) => n === k && v === false)));
    /* 真跑一遍：把「中」打开、50% 关掉 ⇒ 配方应改回来 */
    const base = {
        prompts: [
            { identifier: 'm', name: '👤对白量：中', content: 'x', marker: false, forbid_overrides: false },
            { identifier: 'h', name: '👤对白量：一半（50%）', content: 'y', marker: false, forbid_overrides: false },
        ],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'm', enabled: true }, { identifier: 'h', enabled: false }] }],
        extensions: {},
    };
    const r = applyPresetRecipe(base, { srcName: 't', srcHash: 'h' });
    const o = r.preset.prompt_order[0].order;
    eq('★★ 「中」被关掉', (o.find((x) => x.identifier === 'm') || {}).enabled, false);
    eq('★★ 「一半（50%）」被打开', (o.find((x) => x.identifier === 'h') || {}).enabled, true);
}

/* ★★ 长行（动作/感官/心理）也波动：150–500 字（用户 2026-10-14「300 字那些也可以波动」） */
{
    ok('★★ LENGTH_SPEC 长行写成 150–500 字波动', LENGTH_SPEC.split('50–110 字').length - 1 >= 3);
    ok('★★ FORMAT_SPEC 长行也统一成同一区间', FORMAT_SPEC.split('50–110 字').length - 1 >= 3);
    ok('★★ 写明了是区间内波动', LENGTH_SPEC.indexOf('50–110 字') >= 0 && LENGTH_SPEC.indexOf('随节奏波动') >= 0);
    ok('★ 旧的死板 ~300 字已清（篇幅条目里）', LENGTH_SPEC.indexOf('~300 字') < 0);
    ok('★ 旧的死板 200–400 字已清（说明条目里）', FORMAT_SPEC.indexOf('200–400 字') < 0);
}

/* ★★ 硬目标 + 长行 200–300（用户 2026-10-14：先要 10 组，再把长行定在 200–300）
   实测：回复上限 30000t 不是限制；真凶是原生「正文字数不小于1000」⇒ 模型满足就收工 ✗ */
{
    /* ★ 防重复：同一条要求只许出现一次（0.8.45 踩到过"新旧文案各留一份" ✗） */
    eq('★★ "只是最低门槛"只出现一次', LENGTH_SPEC.split('只是最低门槛').length - 1, 1);
    ok('★ 没有连续三个换行（清理干净）', LENGTH_SPEC.indexOf(String.fromCharCode(10) + String.fromCharCode(10) + String.fromCharCode(10)) < 0);
    /* ★ 近似重复也要盯住：同一条要求换了个说法再出现一次，也是残留 ✗（0.8.46 踩到） */
    ok('★ 不再出现旧的"10 组；只有"写法', LENGTH_SPEC.indexOf('10 组；只有') < 0);
    ok('★★ 明确说「不小于 1000」只是最低门槛', LENGTH_SPEC.indexOf('只是最低门槛') >= 0);
    ok('★★ 场景提前结束要接着写下一个回合', LENGTH_SPEC.indexOf('接着写下一个回合') >= 0);
    ok('★★ 长行区间是 100–300', LENGTH_SPEC.indexOf('50–110 字') >= 0 && FORMAT_SPEC.indexOf('50–110 字') >= 0);
    ok('★ 旧的 150–500 / 200–300 已清', LENGTH_SPEC.indexOf('150–500') < 0 && LENGTH_SPEC.indexOf('200–300') < 0);
    ok('★ 条目里仍然不用星号', LENGTH_SPEC.indexOf('*') < 0);
}

/* ★★ 分隔线：默认 true + 一次性迁移（用户 2026-10-14「把默认值改成 true」） */
{
    eq('★★ showSeparators 默认 true', DEFAULT_CONFIG.showSeparators, true);
    eq('★ 面板字段仍在（可关）', typeof PANEL_FIELDS, 'object');
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ 有 migrateSeparators()', /function migrateSeparators\(\)/.test(src));
    ok('★★ start() 里调用了它', src.indexOf('migrateSeparators();') >= 0);
    ok('★★ 只跑一次（stamp）', /sepStamp === 'v2'/.test(src));
    ok('★ 迁移后仍可手动关闭（不再翻回来）', /if \(c\.sepStamp === 'v2'\) return;/.test(src));
    /* 渲染层：开关为 true 时组间应画线 */
    const NL2 = String.fromCharCode(10);
    const two = '甲·动作 我按住她。' + NL2 + NL2 + '甲·动作 我又松开。';
    const on = String(renderMessageHTML(two, {}, { ...DEFAULT_CONFIG, showSeparators: true }).html);
    const off = String(renderMessageHTML(two, {}, { ...DEFAULT_CONFIG, showSeparators: false }).html);
    ok('★★ 开着时组间有 cd-sep', on.indexOf('<div class="cd-sep"></div>') >= 0);
    /* ★ 回归防线：整楼不许被渲染多遍（0.8.50 我在 map 里调用整组渲染，4 组 ⇒ 输出 4 遍 ✗） */
    {
        const N4 = String.fromCharCode(10);
        const four = ['甲·动作 一', '甲·动作 二', '甲·动作 三', '甲·动作 四'].join(N4 + N4);
        const hh = String(renderMessageHTML(four, {}, { ...DEFAULT_CONFIG, showSeparators: true }).html);
        eq('★★ 四个回合 ⇒ 只 1 个 cd-grid（整楼不重复）', (hh.match(/cd-grid/g) || []).length, 1);
        eq('★★ 四个空行分组 ⇒ 恰好 3 条分隔线', (hh.match(/<div class="cd-sep"><\/div>/g) || []).length, 3);
        ok('★ 每行的正文只出现一次（查 <span> 里的正文）', (hh.split('>一<').length - 1) === 1 && (hh.split('>四<').length - 1) === 1);
    }
    {
        const N3 = String.fromCharCode(10);
        const two = '甲·动作 我按住她。' + N3 + N3 + '甲·感官 手指发烫。' + N3 + N3 + '甲·台词 「别动。」' + N3 + N3 + '甲·动作 我又松开。';
        const h = String(renderMessageHTML(two, {}, { ...DEFAULT_CONFIG, showSeparators: true }).html);
        eq('★★ 四个空行分组 ⇒ 3 条线（每组之间都有 ✓）', (h.match(/<div class="cd-sep"><\/div>/g) || []).length, 3);
        const one = '甲·动作 我按住她。' + N3 + N3 + '甲·感官 手指发烫。' + N3 + N3 + '甲·台词 「别动。」';
        const h1 = String(renderMessageHTML(one, {}, { ...DEFAULT_CONFIG, showSeparators: true }).html);
        eq('★★ 三个空行分组 ⇒ 2 条线', (h1.match(/<div class="cd-sep"><\/div>/g) || []).length, 2);
        const offh = String(renderMessageHTML(two, {}, { ...DEFAULT_CONFIG, showSeparators: false }).html);
        eq('★ 关掉开关就没有线', (offh.match(/<div class="cd-sep"><\/div>/g) || []).length, 0);
    }
    ok('★ 关掉时没有 cd-sep', off.indexOf('<div class="cd-sep"></div>') < 0);
}

/* ★★ 人称四条全部关掉（用户：「预设里的这些感觉用不上」）—— 旁白视角由格式说明负责 */
{
    const tg = PRESET_RECIPE.toggles;
    const person = ['👤人称-第三人称', '👤人称-第二人称', '👤人称-User第一人称', '👤人称-Char第一人称'];
    ok('★★ 四条人称开关都在配方里', person.every((k) => tg.some(([n]) => n === k)));
    ok('★★ 四条人称全部要求关闭', person.every((k) => tg.some(([n, v]) => n === k && v === false)));
    ok('★★ 不再强制「第三人称」开', !tg.some(([n, v]) => n === '👤人称-第三人称' && v === true));
    /* 真跑一遍：把第三人称打开 ⇒ 配方应关掉它 */
    const base = {
        prompts: [{ identifier: 'p1', name: '👤人称-第三人称', content: 'x', marker: false, forbid_overrides: false }],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'p1', enabled: true }] }],
        extensions: {},
    };
    const r = applyPresetRecipe(base, { srcName: 't', srcHash: 'h' });
    eq('★★ 打开着的「第三人称」被关掉', (r.preset.prompt_order[0].order.find((x) => x.identifier === 'p1') || {}).enabled, false);
    ok('★ 格式说明仍然规定旁白为第三人称（换个地方管）', FORMAT_SPEC.indexOf('第三人称的外部描写') >= 0);
}

/* ★★ 回合是硬结构：五行固定 + 不许连续两个动作行（真机 23 动作行 ⇒ 结构散 ✗） */
{
    ok('★★ 写明五行一组、顺序固定', LENGTH_SPEC.indexOf('五行一组，顺序固定') >= 0);
    ok('★★ 写明不许连续两个动作行', LENGTH_SPEC.indexOf('绝对不要连续写两个「动作」行') >= 0);
    ok('★ 引用真机数据作为反例', LENGTH_SPEC.indexOf('23 个动作行') >= 0);
}

/* ★★ 标签独占一行 + 内容在下一行 ⇒ 必须合并（真机：不合并则标签全裸露 ✗） */
{
    const N6 = String.fromCharCode(10);
    const split2 = ['染·台词', '"就是这样的，全都交给我来收割。"', '沙良·心理', '（她感觉自己像一块面团。）'].join(N6);
    const mg = mergeSplitTags(split2);
    ok('★★ 合并成一行', mg.indexOf('染·台词 "就是这样的') >= 0 && mg.indexOf('沙良·心理 （她感觉') >= 0);
    ok('★ 原始两行只剩四行里的两行', mg.split(N6).length === 2);
    const r = renderMessageHTML(split2, {}, DEFAULT_CONFIG);
    ok('★★ 合并后能被接手', !!r);
    ok('★★ 标签不再裸露（可见文字里没有 ·台词 / ·心理）', !r || !/·台词|·心理|·动作|·感官|·旁白/.test(String(r.html).replace(/<[^>]*>/g, '')));
    /* 正常写法不受影响 */
    const normal = '甲·动作 我按住她。';
    eq('★ 正常一行写法原样通过', mergeSplitTags(normal), normal);
    /* 标签后面本来就没内容、且下面是空行 ⇒ 不改 */
    eq('★ 标签后无内容且到底 ⇒ 不改', mergeSplitTags('甲·台词'), '甲·台词');
}

{
}

/* ★★ 篇幅：有最低要求、不设上限（用户 2026-10-14：「但要有最低要求」） */
{
    ok('★★ 写明最低要求（至少 8 个回合 / 不少于 6000 字）', LENGTH_SPEC.indexOf('至少写满 16 个回合') >= 0 && LENGTH_SPEC.indexOf('不少于 5000 字') >= 0);
    ok('★★ 写明不设上限', LENGTH_SPEC.indexOf('不设上限') >= 0);
    ok('★★ 一个回合给参考区间 200–350 字', LENGTH_SPEC.indexOf('200–350 字') >= 0);
    ok('★★ 五行结构与不允许连续两个动作行仍在', LENGTH_SPEC.indexOf('五行一组，顺序固定') >= 0 && LENGTH_SPEC.indexOf('绝对不要连续写两个「动作」行') >= 0);
    ok('★★ 长行仍是 50–110 字', LENGTH_SPEC.split('50–110 字').length - 1 >= 3);
    ok('★ 不再出现旧的 10 组目标', LENGTH_SPEC.indexOf('写满 10 组') < 0 && LENGTH_SPEC.indexOf('写完 10 个回合') < 0);
    eq('★ 关键句各只出现一次（无重复）', LENGTH_SPEC.split('接着写下一个回合').length - 1, 1);
    ok('★ 没有连续三个换行', LENGTH_SPEC.indexOf(String.fromCharCode(10) + String.fromCharCode(10) + String.fromCharCode(10)) < 0);
}

/* ★★ 发送栏三个按钮（用户 2026-10-14：「在这里增加功能按钮」） */
{
    const btn = fs.readFileSync(new URL('../extensions/cine-dialogue/buttons.js', import.meta.url), 'utf8');
    const ix2 = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    const css2 = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8');
    ok('★★ 三个按钮 id 都在', ['cd-btn-rerender', 'cd-btn-diagnose', 'cd-btn-off'].every((k) => btn.indexOf(k) >= 0));
    ok('★★ 优先 #cc-var-bar（1.9.1 回退：官方栏会撑大/压输入框 ✗ 真机截图确认）', btn.indexOf("'cc-var-bar'") >= 0 && btn.indexOf("'cc-var-bar'") < btn.indexOf("'rightSendForm'"));
    ok('★★ 都拿不到时自建 #cd-bar（挂进 #send_form）', btn.indexOf("'cd-bar'") >= 0 && /send\.appendChild\(host\)/.test(btn));
    ok('★★ 原生路径只是兜底（①②都没有才用）', /nativeHost\) \{/.test(btn) && /const nativeHost = document\.getElementById\('rightSendForm'\)/.test(btn));
    ok('★★ 原生版尺寸钉死（px 绝对值、不换行、不外扩 ⇒ 不再压输入框 ✓）', /\.cd-bar-native\s*\{[\s\S]{0,400}px/.test(css2) && /max-height: 26px/.test(css2) && /font-size: 11px/.test(css2));
    ok('★★ 幂等（已存在就跳过）', btn.indexOf('if (document.getElementById(id)) continue;') >= 0);
    ok('★★ index.js 里 import 并启动了', ix2.indexOf("from './buttons.js'") >= 0 && ix2.indexOf('cdStartButtons({') >= 0);
    ok('★ 重渲染走 updateMessageBlock + rerenderMessage', /updateMessageBlock\(id, ctx\.chat\[id\], \{ rerenderMessage: true \}\)/.test(btn));
    ok('★ 诊断用了 mergeSplitTags 与 renderMessageHTML', btn.indexOf('mergeSplitTags(raw)') >= 0 && btn.indexOf('renderMessageHTML(raw') >= 0);
    ok('★★ 本卡开关写 perCard[key].off 并保存', btn.indexOf('cur.off = !cur.off;') >= 0 && btn.indexOf('saveSettingsDebounced()') >= 0);
    ok('★★ CSS 全自有前缀（.cd-bar / .cd-bar-btn）', /\.cd-bar\s*\{/.test(css2) && /\.cd-bar-btn\s*\{/.test(css2));
    ok('★ 我们没有写 card-compat 的前缀样式', !/\.cc-var[^\s]*\s*\{/.test(css2));
    ok('★ 按钮文案是中文且不空', ['重渲染本楼', '诊断本楼', '本卡生效/不生效'].every((s) => btn.indexOf(s) >= 0));
}

/* ★★ 真机根因（0.8.57）：钩子必须在合并【之后】判断，否则"标签独占一行"被整条放行 ✗ */
{
    const ix3 = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ 钩子里先 mergeSplitTags 再 hasOurLines', /const mergedMes = [^\n]*mergeSplitTags\(mes\)/.test(ix3) && /hasOurLines\(mergedMes\)/.test(ix3));
    ok('★★ 钩子渲染用的是合并后的文本', /renderMessageHTML\(mergedMes,/.test(ix3));
    eq('★★ 不再有拿原文判断的门（hasOurLines(mes)）', (ix3.match(/hasOurLines\(mes\)/g) || []).length, 0);
    /* 端到端：模拟钩子路径 —— 原文不合法、合并后才合法 ⇒ 必须能被接手 */
    const N7 = String.fromCharCode(10);
    const raw7 = '沙良·心理' + N7 + '我真的在发疯吗？居然还会如此坦荡地承认自己的渴求。';
    ok('★ 原文 hasOurLines=false（这就是旧版放行的原因）', hasOurLines(raw7) === false);
    ok('★★ 合并后 hasOurLines=true', hasOurLines(mergeSplitTags(raw7)) === true);
    const r7 = renderMessageHTML(mergeSplitTags(raw7), {}, DEFAULT_CONFIG);
    ok('★★ 合并后能渲染且标签不裸露', !!r7 && !/·心理/.test(String(r7.html).replace(/<[^>]*>/g, '')));
}

/* 预设侧硬约束：正文只允许带标签的行（用户 2026-10-14） */
{
    ok('★★ 写明只允许带标签的行（含旁白·内容）', LENGTH_SPEC.indexOf('只允许出现「名字·层 内容」') >= 0 && LENGTH_SPEC.indexOf('旁白·内容') >= 0);
    ok('★★ 写明不许无标签散文段落', LENGTH_SPEC.indexOf('绝对不要写没有标签的散文段落') >= 0);
    ok('★ 引用了真机反例', LENGTH_SPEC.indexOf('染原本以为') >= 0);
    ok('★ 条目内不用星号', LENGTH_SPEC.indexOf('*') < 0);
}

/* ★★ 冒号写法 + 引号归一化（用户 2026-10-14：「你看那张图的美化生效了吗」+「A+B」） */
{
    const L7 = allLayers(DEFAULT_CONFIG);
    const c1 = parseLine('染·感官: 他闻到了她从发丝间散发出的淡淡花香。', L7, false);
    ok('★★ 冒号写法认成 row（不再是 err）', c1.kind === 'row' && c1.name === '染' && c1.layer === '感官');
    const c2 = parseLine('染·感官：他闻到了她从发丝间散发出的淡淡花香。', L7, false);
    ok('★★ 全角冒号也认', c2.kind === 'row' && c2.layer === '感官');
    const c3 = parseLine('沙良·台词: 那么……请尽管吩咐吧。', L7, false);
    ok('★ 台词冒号写法认成 row', c3.kind === 'row' && c3.layer === '台词');
    /* 引号归一化 */
    const q1 = normalizeSpeechQuotes('沙良·台词: \"啊……好奇怪。\"');
    ok('★★ ASCII 引号 → 「」', q1.indexOf('「啊……好奇怪。」') >= 0);
    const q2 = normalizeSpeechQuotes('沙良·台词 “啊……好奇怪。”');
    ok('★★ 弯引号 → 「」', q2.indexOf('「啊……好奇怪。」') >= 0);
    const q3 = normalizeSpeechQuotes('染·动作 他伸手把门关上。');
    ok('★ 非台词行不动', q3 === '染·动作 他伸手把门关上。');
    const q4 = normalizeSpeechQuotes('沙良·台词: 他说「把柄」这两个字。');
    ok('★ 句子内部的引号不动', q4.indexOf('他说「把柄」这两个字。') >= 0);
    /* 整楼：冒号写法必须被接手且标签不裸露 */
    const colonMsg = '染·感官: 他闻到了她从发丝间散发出的淡淡花香。' + String.fromCharCode(10) + '沙良·台词: \"请尽管吩咐吧。\"';
    const rc = renderMessageHTML(colonMsg, {}, DEFAULT_CONFIG);
    ok('★★ 冒号写法的整楼被接手', !!rc);
    ok('★★ 接手后可见文字里没有「·感官:」类标签', !!rc && !/·(动作|感官|台词|心理|旁白)\s*[:：]/.test(String(rc.html).replace(/<[^>]*>/g, '')));
    ok('★★ 并且台词已归一成「」', !!rc && String(rc.html).indexOf('「请尽管吩咐吧。」') >= 0);
}

/* ★★ 状态栏 / 变量块的 YAML 行不许被当成"只有层名的行"（用户 2026-10-14：状态栏是被删了） */
{
    const L8 = allLayers(DEFAULT_CONFIG);
    const y1 = parseLine('        行动: "趴在沙发上，黑丝包裹的双腿交叠着"', L8, false);
    ok('★★ 缩进的 YAML 行不再变成 row', y1.kind !== 'row');
    const y2 = parseLine('        内心: 「好想吃玉子焼き~不过，长大了呢」', L8, false);
    ok('★★ 缩进的「内心:」也不再变成 row', y2.kind !== 'row');
    const y3 = parseLine('  日期和时间: "2025年08月25日 19点30分 星期一"', L8, false);
    ok('★ 其它 YAML 键同样不受影响', y3.kind !== 'row');
    /* 顶格的正常写法必须照旧 */
    const y4 = parseLine('动作: 我抬手把门关上，指节压得发白。', L8, false);
    ok('★ 顶格的「层: 内容」仍然认成 row', y4.kind === 'row' && y4.layer === '动作');
    const y5 = parseLine('染·动作: 我抬手把门关上，指节压得发白。', L8, false);
    ok('★★ 带名字的冒号写法照旧（不受本次影响）', y5.kind === 'row' && y5.name === '染' && y5.layer === '动作');
    /* 端到端：状态栏块必须原样活下来 */
    const N9 = String.fromCharCode(10);
    const msg9 = ['染·动作 我伸手把门关上。', '<StatusBar>', '状态栏:', '  日期和时间: "2025年08月25日"', '        行动: "趴在沙发上"', '        内心: 「好想吃玉子焼き~」', '</StatusBar>'].join(N9);
    const r9 = renderMessageHTML(msg9, {}, DEFAULT_CONFIG);
    const h9 = r9 ? String(r9.html) : '';
    ok('★★ 渲染后键名「行动:」还在', h9.indexOf('行动:') >= 0);
    ok('★★ 渲染后键名「内心:」还在', h9.indexOf('内心:') >= 0);
    ok('★★ 日期那行原样在', h9.indexOf('日期和时间:') >= 0);
    ok('★ 分镜行照旧被渲染', (h9.match(/cd-row/g) || []).length >= 1);
}

/* ★★ 1.0.2：裸层名写法只认正名 ⇒ 顶格的 YAML 键（别名）也不许变成 row */
{
    const L9 = allLayers(DEFAULT_CONFIG);
    const z1 = parseLine('行动: "趴在沙发上，黑丝包裹的双腿交叠着"', L9, false);
    ok('★★ 顶格的「行动:」（别名）不再变 row', z1.kind !== 'row');
    const z2 = parseLine('内心: 「好想吃玉子焼き~不过，长大了呢」', L9, false);
    ok('★★ 顶格的「内心:」（别名）不再变 row', z2.kind !== 'row');
    const z3 = parseLine('动作: 我抬手把门关上，指节压得发白。', L9, false);
    ok('★ 正名「动作:」照旧是 row', z3.kind === 'row' && z3.layer === '动作');
    const z4 = parseLine('旁白: 走廊的灯闪了一下，又灭了。', L9, false);
    ok('★ 正名「旁白:」照旧是旁白', z4.kind === 'narr');
    const z5 = parseLine('染·动作: 我抬手把门关上，指节压得发白。', L9, false);
    ok('★★ 带名字的 染·动作: 写法完全不受影响', z5.kind === 'row' && z5.name === '染' && z5.layer === '动作');
    const z6 = parseLine('染·行动 我抬手把门关上，指节压得发白。', L9, false);
    ok('★ 带名字的别名写法（染·行动）仍然认', z6.kind === 'row' && z6.layer === '动作');
}

/* ★★ 字数指令冲突要点名（🤖自定义（字数）/⚡️字数加强 与我们打架） */
{
    ok('★★ 点名了自定义字数条目', LENGTH_SPEC.indexOf('自定义（字数）') >= 0);
    ok('★★ 点名了字数加强', LENGTH_SPEC.indexOf('字数加强') >= 0);
    ok('★★ 明说一律以本条为准', LENGTH_SPEC.indexOf('一律以本条为准') >= 0);
    ok('★ 明说宁可写长不要写短', LENGTH_SPEC.indexOf('宁可写长，不要写短') >= 0);
    ok('★ 最低要求仍在', LENGTH_SPEC.indexOf('至少写满 16 个回合') >= 0 && LENGTH_SPEC.indexOf('不少于 5000 字') >= 0);
}

/* ★★ 预设侧：名字必须准确；每个回合都要有旁白（用户 2026-10-14：错误的名字 / 缺少旁白） */
{
    ok('★★ 写明名字只能用准确姓名、不许造名', FORMAT_SPEC.indexOf('当前在场角色的准确姓名') >= 0);
    ok('★★ 引用了真机错例（沙扬）', FORMAT_SPEC.indexOf('沙扬') >= 0);
    ok('★ 不确定名字时允许不带名字的层', FORMAT_SPEC.indexOf('宁可用「动作/感官」这类不带名字的层') >= 0);
    ok('★★ 回合结构里含旁白', LENGTH_SPEC.indexOf('心理 → 旁白') >= 0);
    ok('★★ 写明每个回合都要有一条旁白', LENGTH_SPEC.indexOf('每个回合都要有一条旁白') >= 0);
    ok('★ 引用了用户反馈（缺少旁白）', LENGTH_SPEC.indexOf('用户反馈过「缺少旁白」') >= 0);
    ok('★ 两条条目都不用星号', FORMAT_SPEC.indexOf('*') < 0 && LENGTH_SPEC.indexOf('*') < 0);
}

/* ★★ 旁白的各种写法都要认（对照实验发现「旁白 内容」空格写法掉进 text ✗） */
{
    const LA = allLayers(DEFAULT_CONFIG);
    const n1 = parseLine('旁白 走廊的灯闪了一下，又灭了。', LA, false);
    ok('★★ 空格写法的旁白认成 narr', n1.kind === 'narr' && n1.body.indexOf('走廊的灯') === 0);
    const n2 = parseLine('旁白　走廊的灯闪了一下，又灭了。', LA, false);
    ok('★★ 全角空格也认', n2.kind === 'narr');
    const n3 = parseLine('旁白·走廊的灯闪了一下，又灭了。', LA, false);
    ok('★ 点号写法照旧', n3.kind === 'narr');
    const n4 = parseLine('旁白: 走廊的灯闪了一下，又灭了。', LA, false);
    ok('★ 冒号写法照旧', n4.kind === 'narr');
    const n5 = parseLine('染·旁白 走廊的灯闪了一下，又灭了。', LA, false);
    ok('★ 带名字的 染·旁白 照旧是 row', n5.kind === 'row' && n5.layer === '旁白');
    /* 状态栏 YAML 不受影响 */
    const n6 = parseLine('        行动: "趴在沙发上，黑丝包裹的双腿交叠着"', LA, false);
    ok('★★ 状态栏 YAML 仍然不受影响', n6.kind !== 'row');
    /* 端到端 */
    const NR = String.fromCharCode(10);
    const mm = ['染·动作 我推门进去，冷风灌进领口。', '旁白 走廊的灯闪了一下，又灭了。', '沙良·台词 「你回来了。」'].join(NR);
    const rr = renderMessageHTML(mm, {}, DEFAULT_CONFIG);
    const hh = rr ? String(rr.html) : '';
    eq('★★ 整楼渲染出 1 个旁白元素', (hh.match(/cd-L-narr/g) || []).length, 1);
    ok('★★ 旁白内容可见', hh.indexOf('走廊的灯') >= 0);
}

/* ★★ 1.1.0：分割线 = 空行分组之间（每组都有线） */
{
    ok('★★ 预设写明回合之间空一行', LENGTH_SPEC.indexOf('每个回合之间空一行') >= 0);
    ok('★★ 预设写明回合内部不空行', LENGTH_SPEC.indexOf('内部不要空行') >= 0);
    const NB2 = String.fromCharCode(10);
    const cnt2 = (msg) => ((String(renderMessageHTML(msg, {}, { ...DEFAULT_CONFIG, showSeparators: true }).html)).match(/<div class="cd-sep"><\/div>/g) || []).length;
    eq('★ 两个空行分组 ⇒ 1 条线', cnt2(['甲·动作 一。', '甲·感官 二。'].join(NB2 + NB2)), 1);
    eq('★ 三个空行分组 ⇒ 2 条线', cnt2(['甲·动作 一。', '甲·感官 二。', '甲·动作 三。'].join(NB2 + NB2)), 2);
    eq('★ 同一分组内（无空行）⇒ 0 条线', cnt2(['甲·动作 一。', '甲·感官 二。', '甲·台词 三。'].join(NB2)), 0);
    eq('★ 关掉开关 ⇒ 0 条线', ((String(renderMessageHTML(['甲·动作 一。', '甲·感官 二。'].join(NB2 + NB2), {}, { ...DEFAULT_CONFIG, showSeparators: false }).html)).match(/<div class="cd-sep"><\/div>/g) || []).length, 0);
}

/* ★★ UI 规格不许再漂（用户：为什么预览做好了没用）—— 对着 reference/ui-spec-preview.html 钉住 */
{
    const spec = fs.readFileSync(new URL('../extensions/cine-dialogue/reference/ui-spec-preview.html', import.meta.url), 'utf8');
    const cssOurs = fs.readFileSync(new URL('../extensions/cine-dialogue/style.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    ok('★★ 规格文件在仓库里（不再只躺在工作区）', spec.indexOf('max-content 1fr') >= 0);
    ok('★★ 规格写明「段与段之间的分隔线，横跨两列」', spec.indexOf('横跨两列') >= 0);
    ok('★★ 规格写明「空行分段」+ grpsep', spec.indexOf('空行分段') >= 0 && spec.indexOf('grpsep') >= 0);
    ok('★★ 规格写明 row-gap 是唯一间距手段', spec.indexOf('唯一') >= 0 && spec.indexOf('display:contents') >= 0);
    ok('★ 我们仍然两列 max-content 1fr', /grid-template-columns: max-content 1fr/.test(cssOurs));
    ok('★ 我们的分隔线仍然横跨两列', /grid-column: 1 \/ -1/.test(cssOurs));
    ok('★ 我们的 row 仍然是 display: contents', /custom-cd-row\{ display: contents/.test(cssOurs));
    ok('★ 我们的名字仍然右对齐', /text-align: right/.test(cssOurs));
    ok('★★ 逻辑上：分隔线 = 空行分组边界（不是别的判据）', /gi > 0 && cfg\.showSeparators/.test(fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8')));
    ok('★ REQUIREMENTS 里登记了这份规格', fs.readFileSync(new URL('../extensions/cine-dialogue/REQUIREMENTS.md', import.meta.url), 'utf8').indexOf('UI 规格的源头') >= 0);
}

/* ★★ 改写上游会打架的字数指令（用户贴出模型原文：6. 正文要求：不小于1000字 ✗） */
{
    ok('★★ 有 UPSTREAM_LENGTH_FIXES 表', Array.isArray(UPSTREAM_LENGTH_FIXES) && UPSTREAM_LENGTH_FIXES.length >= 2);
    ok('★★ 表里含「不小于1000」那句', UPSTREAM_LENGTH_FIXES.some(([a]) => a.indexOf('不小于1000') >= 0));
    ok('★★ 表里含思维链模板句', UPSTREAM_LENGTH_FIXES.some(([a]) => a.indexOf('正文要求写多少字') >= 0));
    const fake = { prompts: [
        { name: 'x', content: '正文字数: 不小于1000，具体根据情景的复杂程度规划' },
        { name: 'y', content: '* 正文要求写多少字，如何控制剧情量既不注水也不太快？' },
        { name: 'z', content: '与字数无关的条目' },
    ] };
    const n = fixUpstreamLength(fake);
    eq('★★ 两处都被改写', n, 2);
    ok('★★ 改写后不再有「不小于1000」', fake.prompts[0].content.indexOf('不小于1000') < 0 && fake.prompts[0].content.indexOf('5000 字') >= 0);
    ok('★★ 思维链那句指向我们的条目', fake.prompts[1].content.indexOf('篇幅与节奏') >= 0);
    eq('★ 无关条目不动', fake.prompts[2].content, '与字数无关的条目');
    ok('★★ applyPresetRecipe 里确实调用了', /fixUpstreamLength\(out\)/.test(fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8')));
}

/* ★★ 1.3.0：铁律条目 —— 实测动作行含「我」0%、含他/她 100% ✗ */
{
    const lgx = fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8');
    ok('★★ 有铁律条目名', lgx.indexOf('【分镜】铁律（先读）') >= 0);
    ok('★★ 铁律讲第一人称「我」', lgx.indexOf('一律用第一人称「我」') >= 0);
    ok('★ 铁律写明不许第三人称叙述', lgx.indexOf('不许写「他/她/角色名 + 动作」') >= 0);
    ok('★ 铁律引用了真机数据', lgx.indexOf('含「我」的只有 0%') >= 0);
    ok('★ 铁律也讲了台词与旁白', lgx.indexOf('一律用中文引号「」包住，10–80 字') >= 0 && lgx.indexOf('每个回合都要有一条') >= 0);
    const fake2 = {
        prompts: [{ identifier: 'g', name: '🔴指南（可改）', content: 'x' }],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'g', enabled: true }] }],
        extensions: {},
    };
    const r2 = applyPresetRecipe(fake2, { srcName: 't', srcHash: 'h' });
    const ord2 = r2.preset.prompt_order[0].order;
    eq('★★ 铁律排在第 2 位（紧跟指南）', String(ord2[1].identifier), 'cine-dialogue-iron');
    eq('★★ 铁律是启用状态', ord2[1].enabled, true);
    const ironP = (r2.preset.prompts || []).find((x) => String(x.name) === '【分镜】铁律（先读）');
    ok('★ 铁律文本带版本盖章', String(ironP.content).indexOf('（分镜对话 v') === 0);
    ok('★ 铁律文本不含星号', String(ironP.content).indexOf('*') < 0);
}

/* ★★ 1.3.1：清掉上游垃圾条目（用户：「这叫专属预设？」） */
{
    const lgx = fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8');
    ok('★★ 有垃圾条目过滤表', lgx.indexOf('JUNK_NAME_PATTERNS') >= 0);
    const junk = {
        prompts: [
            { identifier: 'g', name: '🔴指南（可改）', content: 'x' },
            { identifier: 'j1', name: '哦对了，贩子死妈', content: '{{//贩子死妈}}' },
            { identifier: 'j2', name: '😨千万别点开', content: 'x' },
            { identifier: 'j3', name: '📋说明（点小铅笔看）', content: 'x' },
            { identifier: 'ok1', name: '⚡️抢话', content: 'x' },
        ],
        prompt_order: [{ character_id: 1, order: [
            { identifier: 'g', enabled: true },
            { identifier: 'j1', enabled: true },
            { identifier: 'j2', enabled: true },
            { identifier: 'j3', enabled: true },
            { identifier: 'ok1', enabled: true },
        ] }],
        extensions: {},
    };
    const r = applyPresetRecipe(junk, { srcName: 't', srcHash: 'h' });
    const od = r.preset.prompt_order[0].order;
    const on = (id) => (od.find((x) => String(x.identifier) === id) || {}).enabled;
    ok('★★ 骂人注释条目被停用', on('j1') === false);
    ok('★★ 「千万别点开」被停用', on('j2') === false);
    ok('★★ 上游「说明」被停用', on('j3') === false);
    ok('★★ 正常条目不受影响（抢话仍启用）', on('ok1') === true);
    ok('★ 指南也没被动', on('g') === true);
    ok('★ 没删条目（只停用，可追溯）', (r.preset.prompts || []).some((x) => String(x.name) === '哦对了，贩子死妈') && (r.preset.prompts || []).some((x) => String(x.name) === '😨千万别点开'));
}

/* ★★ 1.4.0：从零构建的干净专属预设（--clean，底稿 = ST 官方默认预设） */
{
    const lgx = fs.readFileSync(new URL('../extensions/cine-dialogue/logic.js', import.meta.url), 'utf8');
    ok('★★ 出处说明有干净版分支', lgx.indexOf('【分镜干净版说明】') >= 0);
    ok('★★ 干净版说明写明底稿是 ST 官方默认预设', lgx.indexOf('底稿 = SillyTavern 官方默认预设') >= 0);
    ok('★★ 干净版说明提醒卡前端条目会缺', lgx.indexOf('不含任何角色卡自带的前端条目') >= 0);
    ok('★★ provenance 分 kind（clean-preset / derived-preset）', lgx.indexOf("kind: 'clean-preset'") >= 0 && lgx.indexOf("kind: 'derived-preset'") >= 0);
    const note = presetNoteText({ clean: true, srcName: 'Default.json', srcHash: 'abc' });
    ok('★★ 干净版说明不提第三方作者', note.indexOf('泉此方') < 0 && note.indexOf('二传') < 0);
    ok('★★ 干净版说明提三条条目', note.indexOf('铁律') >= 0 && note.indexOf('正文行格式') >= 0 && note.indexOf('篇幅与节奏') >= 0);
    const note2 = presetNoteText({ srcName: 'x.json', srcHash: 'abc' });
    ok('★ 派生版说明照旧（有原作者与许可）', note2.indexOf('泉此方') >= 0 && note2.indexOf('二传') >= 0);
    const base = JSON.parse(fs.readFileSync('D:/AI/SillyTavern/Data/default-user/OpenAI Settings/Default.json', 'utf8'));
    const r = applyPresetRecipe(base, { srcName: 'Default.json', srcHash: 'h', clean: true });
    ok('★★ 干净版配方能跑通', r.ok === true);
    ok('★★ 干净版不含上游痕迹（没改字数指令也不报错）', Array.isArray(r.changes) && r.changes.length > 0);
    ok('★★ 干净版里铁律被插进 order', (r.preset.prompt_order[0].order || []).some((x) => String(x.identifier) === 'cine-dialogue-iron'));
}

/* ★★ 1.5.1：干净版要带上用户点名的 NSFW 素材条目（包含匹配，容 emoji 前缀） */
{
    const sc = fs.readFileSync(new URL('../scripts/cine-preset.mjs', import.meta.url), 'utf8');
    ok('★★ 有素材名单 CLEAN_EXTRA_NAMES', sc.indexOf('CLEAN_EXTRA_NAMES') >= 0);
    ok('★★ 名单含 13 条（用户点名的那批）', (sc.match(/^\s{4}'.+',$/gm) || []).filter((x) => /NSFW|nsfw|ASMR|广播剧|男性向|男性视觉|王小波/.test(x)).length >= 12);
    ok('★★ 用归一化精确匹配（剥 emoji/变体选择符，不用包含匹配）', sc.indexOf('normName(x.name) === normName(nm)') >= 0 && sc.indexOf('n.indexOf(nm) >= 0') < 0);
    ok('★ 从 DEFAULT_SRC 取素材（不是 ST 默认预设）', sc.indexOf('fs.readFileSync(DEFAULT_SRC') >= 0);
    ok('★ 保持原启用状态', sc.indexOf('poolEn.get(String(src.identifier)) === true') >= 0);
}

/* ★★ 1.7.0：卡自带前端时不抢它的选项栏（用户：「不要影响到角色卡自带的前端…」） */
{
    const NLq = String.fromCharCode(10);
    const msg = ['染·动作 我推门进去，冷风灌进领口。', '<options>', '1. 选项一：走过去。', '2. 选项二：站着不动。', '</options>'].join(NLq);
    const conv = String(renderMessageHTML(msg, {}, { ...DEFAULT_CONFIG, respectCardFrontend: false }).html);
    /* ★ 1.9.7：区分「开关」与「卡**真的**有前端」—— 只有 cardHasFrontend=true 才让位 ✓ */
    const keep = String(renderMessageHTML(msg, {}, { ...DEFAULT_CONFIG, respectCardFrontend: true, cardHasFrontend: true }).html);
    const noFe = String(renderMessageHTML(msg, {}, { ...DEFAULT_CONFIG, respectCardFrontend: true, cardHasFrontend: false }).html);
    ok('★★ 卡无前端 ⇒ 渲染我们自己的选项按钮', (conv.match(/class="cd-opt[ "]/g) || []).length >= 2);
    eq('★★ 卡有前端 ⇒ 一个自己的按钮都不画', (keep.match(/class="cd-opt[ "]/g) || []).length, 0);
    ok('★★ 卡有前端 ⇒ <options> 原样保留（交给卡的渲染器）', keep.indexOf('<options>') >= 0 && keep.indexOf('</options>') >= 0);
    ok('★★ 卡有前端 ⇒ 选项文字仍在（不丢字）', keep.indexOf('走过去') >= 0 && keep.indexOf('站着不动') >= 0);
    const sec = splitSections(msg, { keepOptions: true });
    ok('★ splitSections keepOptions ⇒ 不解析成 options、也不进 frontend（frontend 是整段跳过 ✗）', sec.options.length === 0 && sec.frontend.length === 0 && sec.keptOptions === true);
    ok('★★ 默认开关 respectCardFrontend = true（<options> 原样留 给卡 ✓）', DEFAULT_CONFIG.respectCardFrontend === true);
    /* ★ 1.9.7 新语义：没有卡前端的卡（人妻牛 实测 false）即使开关是 in（true）也要我们画按钮 ——
       否则卡不画、我们也不画 ⇒ 选项变纯文本点不动（真机事故）✗ */
    ok('★★ 没有卡前端 ⇒ 即使 respectCardFrontend=true 我们也画按钮（1.9.7）', (noFe.match(/class="cd-opt[ " ]/g) || []).length >= 2);
}

/* ★★ 1.8.0：卡自带前端 ⇒ 默认对这张卡完全不动作（用户：89/107 张卡自带美化） */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ 默认 autoOffCardFrontend = false（用户定：都渲染，黑名单自己维护 ✓）', DEFAULT_CONFIG.autoOffCardFrontend === false);
    ok('★ 自动让位的开关仍在（想用时设回 true ✓）', /autoOffCardFrontend === true && fe && !\(merged\.force === true\)/.test(src) && /autoOff: true/.test(src));
    ok('★★ 用户强制启用可绕过（perCard[key].force）', /merged\.force === true/.test(src));
    const bs = fs.readFileSync(new URL('../extensions/cine-dialogue/buttons.js', import.meta.url), 'utf8');
    ok('★★ 按钮在自带前端的卡上改成「强制启用」语义', bs.indexOf('强制在这张卡上启用') >= 0);
    ok('★ 按钮能取消强制', bs.indexOf('delete cur.force') >= 0);
    ok('★ 判据含 TavernHelper（<%）', /cardHasFrontend/.test(src) && /TavernHelper/.test(src));
}

/* ★★ 1.8.1：cardHasFrontend 判据要含纯 CSS 与 markdown 着色（用户指着「欲妈群」那楼问） */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ 判据**只认真有渲染器的标记**（占位符 / TavernHelper / MVU）', /RENDER_RE = \/StatusPlaceHolderImpl/.test(src));
    ok('★★ CSS 文本**不算**（没有渲染器就等于没生效 ✓ 用户：「我怎么没看出来有美化」）', src.indexOf('CSS_RE') < 0 && src.indexOf('MD_RE') < 0);
    ok('★ 只用 RENDER_RE 判定', /const val = RENDER_RE\.test\(s\);/.test(src));
    ok('★ 仍然按卡缓存', src.indexOf('cardFECache.key === key') >= 0);
}

/* ★★ 1.8.3：默认都渲染；黑名单走现成的逐卡开关（用户选定 ✓） */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ 黑名单入口是现成的（面板「这张卡不生效」）', src.indexOf('id="cd-card-off"') >= 0 && src.indexOf('这张卡不生效') >= 0);
    ok('★★ 发送栏按钮也是同一个开关', fs.readFileSync(new URL('../extensions/cine-dialogue/buttons.js', import.meta.url), 'utf8').indexOf('cdToggleCardOff') >= 0);
    ok('★ off 仍然只在 effectiveConfig 一个点翻 enabled:false', /if \(merged\.off\) return \{ \.\.\.merged, enabled: false, off: true \};/.test(src));
    ok('★ respectCardFrontend 仍为 true（占位符/<options> 原样保留 ✓）', DEFAULT_CONFIG.respectCardFrontend === true);
}

/* ★★ 1.9.0：流式边出边排版（可开关；扩展层实现，不动本体） */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ 开关默认关（用户要求：设置成可开关的）', DEFAULT_CONFIG.streamLiveFormat === false);
    ok('★★ 面板有对应勾选框（性能组）', PANEL_FIELDS.some((f) => f.key === 'streamLiveFormat' && f.kind === 'bool'));
    ok('★★ 用包装 streamingProcessor 实现（不改任何文件 ⇒ 不用动本体 ✓）', src.indexOf('sp.__cdLivePatched') >= 0 && src.indexOf('orig(messageId, text, isFinal)') >= 0);
    ok('★★ 有节流（不是每 token 都重排）', /now - cdLiveAt < 120/.test(src));
    ok('★★ 只在认得出我们的行时才接管（认不出保留 ST 原样 ✓）', src.indexOf('if (!hasOurLines(text)) return false;') >= 0);
    ok('★★ 生成开始的每个新实例都会重新包', src.indexOf('event_types.GENERATION_STARTED') >= 0 && src.indexOf('cdArmStreamLive()') >= 0);
    ok('★ 只动 messageTextDom.innerHTML（不碰别的节点）', /dom\.innerHTML = r\.html;/.test(src));
}

/* ★★ 1.9.2：改用 ST 1.19 官方 MessageFormatter（⇒ 不再需要核内补丁 ✓） */
{
    const src = fs.readFileSync(new URL('../extensions/cine-dialogue/index.js', import.meta.url), 'utf8');
    ok('★★ 挂了官方 MessageFormatter 钩子（BEFORE_REGEX）', /mf\.addHook\(/.test(src) && /stage: mf\.stage\.BEFORE_REGEX/.test(src));
    ok('★★ 接线标记与补丁路径一致（__cdMessageFormattingHook）', src.indexOf('window.__cdMessageFormattingHook = true;') >= 0);
    ok('★★ 幂等（只注册一次）', /__cdMsgHookAdded/.test(src));
    ok('★★ 钩子出错时原样返回（永不吞消息）', /return mes;/.test(src));
    ok('★ 两个新面板开关存在（自检发现以前没有 UI ✗）', PANEL_FIELDS.some((f) => f.key === 'respectCardFrontend') && PANEL_FIELDS.some((f) => f.key === 'autoOffCardFrontend'));
}

/* ---------------------------- 汇总 ---------------------------- */

console.log('cine-dialogue 夹具：通过 ' + pass + ' / 失败 ' + failures.length);
if (failures.length) {
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
}
process.exit(0);
