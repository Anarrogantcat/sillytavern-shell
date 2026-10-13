// scripts/cine-dialogue-test.mjs — 分镜对话 Cine Dialogue 夹具测试
// 用法：node scripts/cine-dialogue-test.mjs
// 只测 logic.js（纯函数层）—— 不碰 DOM、不碰 ST、不联网
import {
    VERSION, EXT_ID, LAYERS, LAYER_CLS, PALETTE, DEFAULT_CONFIG,
    esc, parseLine, isOurLine, splitSections, parseBlocks, collectNames,
    assignColors, renderGrid, renderOptions, renderMessage, hasOurLines, stats,
} from '../extensions/cine-dialogue/logic.js';

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    failures.push(name + (extra !== undefined ? ('  → ' + JSON.stringify(extra)) : ''));
}
function eq(name, actual, expected) { ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected }); }

/* ---------------------------- 基础 ---------------------------- */
eq('version 与 manifest 一致', VERSION, '0.1.0');
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

/* ---------------------------- 汇总 ---------------------------- */
console.log('cine-dialogue 夹具：通过 ' + pass + ' / 失败 ' + failures.length);
if (failures.length) {
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
}
process.exit(0);
