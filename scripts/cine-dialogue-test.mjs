// scripts/cine-dialogue-test.mjs — 分镜对话 Cine Dialogue 夹具测试
// 用法：node scripts/cine-dialogue-test.mjs
// 只测 logic.js（纯函数层）—— 不碰 DOM、不碰 ST、不联网
// 例外：末尾有一条「模块链接自检」，只在**本机找得到 ST 本体**时真查（找不到就跳过，不会假红）
import fs from 'node:fs';
import path from 'node:path';
import {
    VERSION, EXT_ID, LAYERS, LAYER_CLS, PALETTE, DEFAULT_CONFIG, PANEL_FIELDS,
    FORMAT_SPEC, REGEX_DEFS, SLASH_COMMAND,
    MARK_OPTIONS, DEFAULT_LAYER_STYLES, EXPORT_SCHEMA, configKeys,
    allLayers, layerVars, resolveColors, validateLayerName, rowDimmed,
    highlightPlan, sceneTitle, messageTitle, rowRegexFor,
    serializeConfig, parseConfig, stClassPrefix, wrapThinkingBlock, hasThinkingBlock, PLAIN_ANCHOR, repairLines, layerClass,
    esc, parseLine, isOurLine, splitSections, parseBlocks, collectNames,
    assignColors, renderGrid, renderOptions, renderMessage, renderMessageHTML, renderSegments,
    hasOurLines, stats,
    applyPresetRecipe, PRESET_UPSTREAM, PRESET_RECIPE, presetNoteText,
} from '../extensions/cine-dialogue/logic.js';

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    failures.push(name + (extra !== undefined ? ('  → ' + JSON.stringify(extra)) : ''));
}
function eq(name, actual, expected) { ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected }); }

/* ---------------------------- 基础 ---------------------------- */
eq('version 与 manifest 一致', VERSION, '0.7.2');
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
ok('默认不画分隔线（避免与行间距叠加）', !r.html.includes('cd-sep'));
ok('打开 showSeparators 才画分隔线', renderMessage(body, {}, { ...DEFAULT_CONFIG, showSeparators: true }).html.includes('cd-sep'));
ok('动作行带 cd-L-act', r.html.includes('cd-L-act'));
ok('心理行带 cd-L-mind', r.html.includes('cd-L-mind'));
ok('旁白行带 cd-L-narr', r.html.includes('cd-L-narr'));
ok('名字在 cd-who 里', r.html.includes('<span class="cd-who">林野</span>'));
ok('颜色写进 --c 变量', r.html.includes('--c:' + PALETTE[0]));
ok('旁白没有名字', /cd-L-narr[^>]*><span class="cd-who"><\/span>/.test(r.html));
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
const rSeg = renderMessageHTML(thinkingLike, {}, DEFAULT_CONFIG);
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
const hRes = renderMessageHTML(hRaw, {}, DEFAULT_CONFIG);
ok('钩子产出网格', !!hRes && hRes.html.includes('cd-grid'));
ok('钩子产出：前端 HTML 未被转义（原样拼回）', hRes.html.includes('<div>前端</div>'));
ok('钩子产出：选项按钮已渲染', hRes.html.includes('data-cd-text="吻她"'));
/* ★ 回归：选项必须在 .cd-root **内部** —— 主题变量定义在 .cd-root 上，
   拼在外面就继承不到 → var() 失效 → 选项回落成浏览器默认白底按钮（真机踩过）。 */
ok('选项在 .cd-root 内部（否则拿不到主题变量）',
    hRes.html.indexOf('cd-options') < hRes.html.lastIndexOf('</div>')
    && /class="cd-root[^"]*"[\s\S]*cd-options[\s\S]*<\/div>\s*$/.test(hRes.html.replace(/<htmlcontent>[\s\S]*$/, '')));
ok('钩子产出：标签不出现', !hRes.html.includes('·动作'));
ok('钩子产出：旁白无名字', /cd-L-narr[^>]*><span class="cd-who"><\/span>/.test(renderMessageHTML('旁白·灯灭了。\n林野·动作 我按住她。').html));

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
eq('resolveColors：没点名的按出现顺序', resolveColors(['林野', '苏晴'], {})['林野'], PALETTE[0]);
eq('resolveColors：点名不影响别人拿色', resolveColors(['林野', '苏晴'], { charColors: { '苏晴': '#abcdef' } })['林野'], PALETTE[0]);

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
const CODE_MANAGED = ['palette', 'layerStyles', 'charColors', 'perCard', 'customLayers', 'onlyChar', 'highlight'];
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
       （flex 项的 min-content 对中文只有一个汉字宽 → 不锁 nowrap 就会竖排，真机截图） */
    const btnAt = css.indexOf('#cd-panel .cd-btn-row .menu_button');
    ok('★ 按钮有专门的 nowrap 规则', btnAt >= 0);
    const btnSeg = btnAt >= 0 ? css.slice(btnAt, btnAt + 300) : '';
    ok('★ 按钮锁了 white-space: nowrap', /white-space\s*:\s*nowrap/.test(btnSeg), btnSeg.slice(0, 100));
    ok('★ 按钮禁了收缩（flex: 0 0 auto）', /flex\s*:\s*0\s+0\s+auto/.test(btnSeg), btnSeg.slice(0, 100));
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
    const r = renderMessageHTML(mixed, {}, DEFAULT_CONFIG);
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
    eq('★ 人称-第三人称 开', r.preset.prompt_order[0].order.find(o => o.identifier === 'b').enabled, true);
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
    ok('★ 面板里写着原作者与许可（用户看得见）',
        /PRESET_UPSTREAM\.author/.test(idxSrc) && /PRESET_UPSTREAM\.license/.test(idxSrc));
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

/* ---------------------------- 汇总 ---------------------------- */
console.log('cine-dialogue 夹具：通过 ' + pass + ' / 失败 ' + failures.length);
if (failures.length) {
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
}
process.exit(0);
