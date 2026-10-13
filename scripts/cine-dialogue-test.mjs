// scripts/cine-dialogue-test.mjs — 分镜对话 Cine Dialogue 夹具测试
// 用法：node scripts/cine-dialogue-test.mjs
// 只测 logic.js（纯函数层）—— 不碰 DOM、不碰 ST、不联网
import {
    VERSION, EXT_ID, LAYERS, LAYER_CLS, PALETTE, DEFAULT_CONFIG, PANEL_FIELDS,
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
eq('version 与 manifest 一致', VERSION, '0.3.0');
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
ok('旁白没有名字', /cd-L-narr"><span class="cd-who"><\/span>/.test(r.html));
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
ok('钩子产出：旁白无名字', renderMessageHTML('旁白·灯灭了。').html.includes('cd-L-narr"><span class="cd-who"></span>'));

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

/* ---------------------------- 汇总 ---------------------------- */
console.log('cine-dialogue 夹具：通过 ' + pass + ' / 失败 ' + failures.length);
if (failures.length) {
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
}
process.exit(0);
