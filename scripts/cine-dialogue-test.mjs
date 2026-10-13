// scripts/cine-dialogue-test.mjs — 分镜对话 Cine Dialogue 夹具测试
// 用法：node scripts/cine-dialogue-test.mjs
// 只测 logic.js（纯函数层）—— 不碰 DOM、不碰 ST、不联网
import {
    VERSION, EXT_ID, LAYERS, LAYER_CLS, PALETTE, DEFAULT_CONFIG, PANEL_FIELDS,
    FORMAT_SPEC, REGEX_DEFS, SLASH_COMMAND,
    MARK_OPTIONS, DEFAULT_LAYER_STYLES, EXPORT_SCHEMA, configKeys,
    allLayers, layerVars, resolveColors, validateLayerName, rowDimmed,
    highlightPlan, sceneTitle, messageTitle, rowRegexFor,
    serializeConfig, parseConfig,
    esc, parseLine, isOurLine, splitSections, parseBlocks, collectNames,
    assignColors, renderGrid, renderOptions, renderMessage, renderMessageHTML,
    hasOurLines, stats,
} from '../extensions/cine-dialogue/logic.js';

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    failures.push(name + (extra !== undefined ? ('  → ' + JSON.stringify(extra)) : ''));
}
function eq(name, actual, expected) { ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected }); }

/* ---------------------------- 基础 ---------------------------- */
eq('version 与 manifest 一致', VERSION, '0.5.0');
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
eq('层后漏空格 → other（显式暴露，不猜）', parseLine('林野·动作我按住了她。').kind, 'other');
eq('没有层标签 → other', parseLine('随便一句话。').kind, 'other');
eq('空行 → other', parseLine('').kind, 'other');
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

const badOut = parseBlocks('林野·动作 正确的行。\n这行没有标签。');
eq('格式错的行被计数', badOut.errs, 1);

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
ok('两条组之间有线', r.html.includes('cd-sep'));
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

const rBad = renderMessage('林野·动作 对的。\n这行漏了标签。', {}, DEFAULT_CONFIG);
ok('格式错行被标红', rBad.html.includes('cd-err'));
ok('格式错行原文可见', rBad.html.includes('格式错误'));
const rBadOff = renderMessage('林野·动作 对的。\n这行漏了标签。', {}, { ...DEFAULT_CONFIG, markErrors: false });
ok('markErrors=false 时不输出错误行', !rBadOff.html.includes('cd-err'));

/* XSS：内容里的标签必须被转义 */
const rXss = renderMessage('林野·动作 <img src=x onerror=alert(1)>', {}, DEFAULT_CONFIG);
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
const hRaw = '林野·动作 我把她按在床上。\n<htmlcontent><div>前端</div></htmlcontent>\n<options>\n>选项一：吻她\n>选项二：按住她\n</options>';
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
ok('钩子产出：标签不出现', !hRes.html.includes('·动作'));
ok('钩子产出：旁白无名字', /cd-L-narr[^>]*><span class="cd-who"><\/span>/.test(renderMessageHTML('旁白·灯灭了。').html));

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
    PANEL_FIELDS.every(f => !!f.label && ['bool', 'select', 'number'].indexOf(f.kind) >= 0),
    PANEL_FIELDS.filter(f => !f.label || ['bool', 'select', 'number'].indexOf(f.kind) < 0).map(f => f.key));
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
ok('没登记过的层名 → other（不乱认，避免把散文当分镜）', parseLine('广播·未登记 提示音。').kind === 'other');
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

/* ---------------------------- 汇总 ---------------------------- */
console.log('cine-dialogue 夹具：通过 ' + pass + ' / 失败 ' + failures.length);
if (failures.length) {
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
}
process.exit(0);
