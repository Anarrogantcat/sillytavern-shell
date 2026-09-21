// scripts/compat-logic-test.mjs — card-compat 逻辑层夹具断言（不依赖 ST/Electron）
import { readFileSync } from 'node:fs';
import { repairYamlStructure, renderChangelogMarkdown } from '../extensions/card-compat/logic.js';
import { buildProfile, guardText, findUnclosed, freshnessFields, isStale, normalizeMalformedClosings, detectForeignTags, buildTailReminder, dedupeSelfClosingAnchors, extractVarSpec, extractRequiredFields, patchCoverage, repairSmartQuotes, guardBlockYaml, strictYamlCheck, stripUndeclaredBlocks, KEEP_BLOCKS, extractUpdateBlock, validatePatchBlock, buildVarFixPrompt, normalizePath, expandTemplateGroups, parsePatchOps, extractUpdateBlocks, extractAllowedPaths, validatePatchPaths, blockPresence } from '../extensions/card-compat/logic.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + label); }
    else { fail++; console.log('  ❌ ' + label + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

console.log('— 夹具 1：JS-Slash-Runner 型卡（锚点 <StatusPlaceHolderImpl/>）');
const c1 = buildProfile({ regex_scripts: [
    { scriptName: '状态栏', findRegex: '<StatusPlaceHolderImpl/>', placement: [2], replaceString: '<div class="bar">…</div>' },
    { scriptName: '对AI隐藏状态栏', findRegex: '<StatusPlaceHolderImpl/>', placement: [2], replaceString: '' },
    { scriptName: '去变量更新', findRegex: '/<UpdateVariable>.*?</UpdateVariable>/gms', placement: [2], replaceString: '' },
]});
check('锚点=StatusPlaceHolderImpl', c1.anchors.join() === 'StatusPlaceHolderImpl', c1.anchors);
check('数据块=UpdateVariable', c1.dataTags.join() === 'UpdateVariable', c1.dataTags);
const r1 = guardText('正文内容。', c1, { injectAnchor: true, anchorStyle: 'self' });
check('缺失时补自闭合锚点', r1.text.includes('<StatusPlaceHolderImpl/>') && r1.actions.some(a => a.type === 'anchor-injected'), r1);
const r1b = guardText('正文内容。', c1, { injectAnchor: false });
check('未开兜底时不改文本', r1b.text === '正文内容。' && r1b.actions.some(a => a.type === 'anchor-missing'));
check('数据块缺失只报警、不伪造', r1b.actions.some(a => a.type === 'data-missing') && !/UpdateVariable>\S/.test(r1b.text));

console.log('— 夹具 2：<StatusBar> 型卡（未闭合修复）');
const c2 = buildProfile({ regex_scripts: [{ scriptName: '三年的水/状态栏', findRegex: '<StatusBar>([\\s\\S]*?)<\\/StatusBar>', placement: [2], replaceString: '<div>bar</div>' }] });
const r2 = guardText('正文。\n<StatusBar>日期: 2025-01-01 没有闭合', c2, { repairClosure: true });
check('未闭合→自动补 </StatusBar>', r2.text.trimEnd().endsWith('</StatusBar>') && r2.actions.some(a => a.type === 'anchor-close-repaired'), r2);

console.log('— 夹具 3：卡自带「隐藏状态栏」脚本时不得注入');
const c3 = buildProfile({ regex_scripts: [
    { scriptName: 'AI隐藏状态栏', findRegex: '<StatusBar>[\\s\\S]*?<\\/StatusBar>', placement: [2], replaceString: '' },
]});
check('只有剥除脚本 → hideTargets 含 StatusBar', c3.hideTargets.includes('StatusBar'), c3);
const r3 = guardText('正文。', c3, { injectAnchor: true, anchorStyle: 'pair' });
check('只有剥除脚本时不注入', !r3.text.includes('<StatusBar') && !r3.actions.some(a => a.type === 'anchor-injected'), r3);
const c3b = buildProfile({ regex_scripts: [
    { scriptName: 'AI隐藏状态栏', findRegex: '<StatusBar>[\\s\\S]*?<\\/StatusBar>', placement: [2], replaceString: '' },
    { scriptName: '状态栏', findRegex: '<StatusBar>([\\s\\S]*?)<\\/StatusBar>', placement: [2], replaceString: '<div>bar</div>' },
]});
check('剥除+渲染并存 → 仍视为锚点', c3b.injectableAnchors.includes('StatusBar'), c3b);
const r3b = guardText('正文。', c3b, { injectAnchor: true, anchorStyle: 'pair' });
check('并存时应当补锚点', r3b.text.includes('<StatusBar>'), r3b);

console.log('— 夹具 4：数据新鲜度');
const t1 = '地点: 家 天气: 晴 第 1 天 2025年7月18日 14:00';
const t2 = '地点: 家 天气: 晴 第 1 天 2025年7月18日 14:00';
const t3 = '地点: 公司 天气: 雨 第 2 天 2025年7月19日 09:30';
check('字段解析', JSON.stringify(freshnessFields(t1)) === JSON.stringify({ day: '1', date: '2025-7-18', time: '14:00', place: '家', weather: '晴' }), freshnessFields(t1));
check('两轮完全相同→stale', isStale(t1, t2).stale === true, isStale(t1, t2));
check('字段变化→不 stale', isStale(t1, t3).stale === false, isStale(t1, t3));
check('缺字段→不误报', isStale('无字段', '无字段').stale === false);


console.log('— 夹具 5：畸形结束标签修复 + 串卡检测');
const nm = normalizeMalformedClosings('正文。\n<StatusBar>时间 12:00\n</StatusBar', ['StatusBar']);
check('修复 </StatusBar（缺 >）', nm.text.trimEnd().endsWith('</StatusBar>') && nm.fixed.includes('StatusBar'), nm);
const nm2 = normalizeMalformedClosings('正文。\n<StatusBar>x</StatusBar>', ['StatusBar']);
check('已合法的不重复改', nm2.fixed.length === 0, nm2);
const foreign1 = detectForeignTags('正文。\n</status!\n</tucao>', c1);
check('检出串卡标签 status!', foreign1.includes('status!'), foreign1);
const foreign2 = detectForeignTags('正文。\n<StatusPlaceHolderImpl/>', c1);
check('自家标签不误报', !foreign2.includes('StatusPlaceHolderImpl'), foreign2);

console.log('— 夹具 6：结尾提醒注入文本');
const rem = buildTailReminder(c1);
check('包含变量块标签', rem.includes('<UpdateVariable>'), rem.slice(0, 80));
check('包含锚点标签', rem.includes('<StatusPlaceHolderImpl'), rem.slice(0, 120));
check('不点名其他卡的标签', !rem.includes('status!') && !rem.includes('StatusBar'), rem.slice(0, 160));
check('无锚点无数据块时返回空串', buildTailReminder(buildProfile({})) === '');

console.log('— 夹具 7：续写追加出的重复锚点合并');
const dup = '正文一。\n<StatusPlaceHolderImpl/>\n正文二（续写）。\n<StatusPlaceHolderImpl/>';
const dd = dedupeSelfClosingAnchors(dup, ['StatusPlaceHolderImpl']);
check('重复占位符被合并为 1 个', (dd.text.match(/<StatusPlaceHolderImpl\/>/g) || []).length === 1 && dd.removed.length === 1, dd);
const solo = dedupeSelfClosingAnchors('正文。\n<StatusPlaceHolderImpl/>', ['StatusPlaceHolderImpl']);
check('只有一个时不改动', solo.text === '正文。\n<StatusPlaceHolderImpl/>' && solo.removed.length === 0, solo);

console.log('— 夹具 8：变量块格式抽取与注入');
const book = [{ content: '变量输出格式强调:\n  rule: must be inserted to the end of reply\n  format: |-\n    <UpdateVariable>\n    <Analysis>$(IN ENGLISH, no more than 80 words)</Analysis>\n    _.set(\'角色.好感\', 10);\n    </UpdateVariable>\n  其他:\n    x' }];
const spec = extractVarSpec(book);
check('抽出 format 段且含 <UpdateVariable>', spec.includes('<UpdateVariable>') && spec.includes("_.set"), spec.slice(0, 100));
const rem2 = buildTailReminder(c1, { varSpec: spec });
check('提醒里带上格式示例', rem2.includes('<UpdateVariable>') && rem2.includes('_.set'), rem2.length);
check('无格式时退回通用提醒', !buildTailReminder(c1, {}).includes('_.set'));

console.log('— 夹具 9：形态探测与规范化');
const cSelf = buildProfile({ regex_scripts: [{ scriptName: '状态栏', findRegex: '<StatusPlaceHolderImpl/>', placement: [2], replaceString: '<div>bar</div>' }] });
check("自闭合卡 -> anchorForms.self", cSelf.anchorForms.StatusPlaceHolderImpl === 'self', cSelf.anchorForms);
const cPair = buildProfile({ regex_scripts: [{ scriptName: '状态栏', findRegex: '<StatusBar>([\\s\\S]*?)<\\/StatusBar>', placement: [2], replaceString: '<div>bar</div>' }] });
check("成对卡 -> anchorForms.pair", cPair.anchorForms.StatusBar === 'pair', cPair.anchorForms);
const rSelf = buildTailReminder(cSelf);
check("自闭合卡的提醒只写 <Tag/>", rSelf.includes('只写自闭合占位符') && !rSelf.includes('或 <StatusPlaceHolderImpl/>'), rSelf.slice(-200));
const mixed = '正文。\n<StatusPlaceHolderImpl>\n支出_陈慧兰: 0\n</StatusPlaceHolderImpl>\n\n<StatusPlaceHolderImpl/>';
const norm = guardText(mixed, cSelf, { injectAnchor: true, anchorStyle: 'self' });
check('成对块被规范成自闭合（去重）', (norm.text.match(/<StatusPlaceHolderImpl\/>/g) || []).length === 1 && !norm.text.includes('</StatusPlaceHolderImpl>'), norm.text.slice(-120));
check('记录了 anchor-form-normalized', norm.actions.some(a => a.type === 'anchor-form-normalized'), norm.actions);

console.log('— 夹具 10：必更字段抽取与 patch 覆盖度');
const rulesText = ['---', '变量更新规则:', '  系统:', '    日期:', '      format: YYYY年MM月DD日', '      check:', '        - 每次场景跳转或时间推进后更新', '        - 与剧情天数同步推进', '    时间:', '      format: HH:MM', '      check:', '        - 每次场景跳转或时间推进后更新', '    地点:', '      check:', '        - 角色移动到新场景后更新', '  林婉婷:', '    位置:', '      check:', '        - 角色移动到新场景后更新', '    外貌.${发型|妆容|表情}:', '      check:', '        - 状态变化时更新'].join('\n');
const req = extractRequiredFields([{ content: rulesText }], 10);
const paths = req.map(r => r.path);
check('抽出 系统.日期/时间/地点', paths.includes('系统.日期') && paths.includes('系统.时间') && paths.includes('系统.地点'), paths);
check('模板组被展开为 3 条', paths.filter(p => p.indexOf('林婉婷.外貌.') === 0).length === 3, paths);
check('check 条件被带上', ((req.find(r => r.path === '系统.日期') || {}).check || '').includes('每次场景跳转'), req.find(r => r.path === '系统.日期'));
const realBlock = '<UpdateVariable>\n<Analysis>x</Analysis>\n<JSONPatch>\n[ { "op": "replace", "path": "/系统/时间", "value": "15:30" } ]\n</JSONPatch>\n</UpdateVariable>';
const cov = patchCoverage(realBlock, req);
check('只更时间 -> 缺 日期/地点（复现用户现象）', cov.covered.includes('系统.时间') && cov.missing.includes('系统.日期') && cov.missing.includes('系统.地点'), cov.missing.slice(0, 5));
const rem3 = buildTailReminder(c1, { required: req });
check('提醒里列出必更字段', rem3.includes('本轮必须更新的字段') && rem3.includes('系统.日期'), rem3.slice(-260));

console.log('— 夹具 11：结构块引号错配修复（实测：模型把结束引号写成中文 ” → js-yaml 解析失败 → 状态栏显示「未解析到角色数据」）');
const brokenBlock = [
    '<Status_block>',
    '状态栏:',
    '  用户列表:',
    '    - 用户:',
    '        名字: "😎 染"',
    '        内心: "他在看前面的路。我们的配合正在变得更契合。”',
    '行动选项:',
    '  名字: "😎 染"',
    '</Status_block>',
].join('\n');
const q1 = repairSmartQuotes(brokenBlock, ['Status_block']);
check('故障行改成英文引号', q1.text.includes('变得更契合。"') && !q1.text.includes('契合。”'), q1.text.split('\n')[5]);
check('记录修复项（标签 + 字段）', q1.fixed.length === 1 && q1.fixed[0].tag === 'Status_block' && q1.fixed[0].key === '内心', q1.fixed);
const proseWithSameLine = '正文里也有 内心: "这是一句普通叙述。” 但不该被动';
check('块外正文一个字不动', repairSmartQuotes(proseWithSameLine, ['Status_block']).text === proseWithSameLine);
const alreadyFine = '<T>\n  a: "x"\n</T>';
check('本来就配对的不动', repairSmartQuotes(alreadyFine, ['T']).text === alreadyFine);
const q2 = repairSmartQuotes("<T>\n  a: 'x’\n</T>", ['T']);
check('单引号错配同样修', q2.text === "<T>\n  a: 'x'\n</T>" && q2.fixed.length === 1, q2.text);
check('未声明标签族时原样返回', repairSmartQuotes(brokenBlock, []).fixed.length === 0);
let yamlProof = null;
try {
    const jsyaml = (await import('js-yaml')).default;
    const inner = (s) => (s.match(/<Status_block>([\s\S]*?)<\/Status_block>/) || ['', ''])[1];
    let before = 'ok';
    try { jsyaml.load(inner(brokenBlock)); } catch (_) { before = 'fail'; }
    let after = 'ok';
    try {
        const p = jsyaml.load(inner(q1.text));
        after = (p && p['状态栏'] && Array.isArray(p['状态栏']['用户列表']) && p['状态栏']['用户列表'].length) ? 'ok' : 'no-list';
    } catch (_) { after = 'fail'; }
    yamlProof = { before, after };
} catch (_) { yamlProof = null; }
check('js-yaml 端到端：修复前解析失败、修复后能取出用户列表', !yamlProof || (yamlProof.before === 'fail' && yamlProof.after === 'ok'), yamlProof);

console.log('— 夹具 12：结构块 YAML 预检/修复（裸值含「: 」「 #」会被 YAML 当嵌套键/注释）');
const g1 = guardBlockYaml('<B>\n  内心: 他说: 我要走了\n</B>', ['B']);
check('含「: 」的裸值被加引号', g1.text.includes('内心: "他说: 我要走了"') && g1.fixes.length === 1 && g1.fixes[0].kind === 'quote-scalar', g1.text);
const g2 = guardBlockYaml('<B>\n  备注: 见附件 # 重要\n</B>', ['B']);
check('含「 #」的裸值被加引号', g2.text.includes('备注: "见附件 # 重要"'), g2.text);
const quotedLine = '<B>\n  内心: "他说: 我要走了"\n</B>';
const g3 = guardBlockYaml(quotedLine, ['B']);
check('已经加引号的不重复处理', g3.fixes.length === 0 && g3.text === quotedLine, g3.text);
const g4 = guardBlockYaml('<B>\n  引号: "开了没闭合\n</B>', ['B']);
check('引号开了没闭合 → 只报告不改', g4.fixes.length === 0 && g4.issues.length === 1, g4);
const outside = '正文: 他说: 我要走了';
check('块外一个字不动', guardBlockYaml(outside, ['B']).text === outside);
check('| 字面量块内跳过', guardBlockYaml('<B>\n  正文: |\n    他说: 我要走了\n</B>', ['B']).fixes.length === 0);
const g7 = guardBlockYaml('<B>\n  内心: "结束了。”\n  备注: 裸值: 半\n</B>', ['B']);
check('两类修复可同时发生', g7.fixes.map((f) => f.kind).sort().join(',') === 'quote,quote-scalar', g7.fixes);
const g8 = guardBlockYaml('<B>\n  内心: 他说: 我要走了\n</B>', ['B'], { quoteScalars: false });
check('关掉「自动加引号」开关后不动', g8.fixes.length === 0 && g8.text.includes('他说: 我要走了'), g8.text);
check('关掉「引号修复」开关后不动', guardBlockYaml('<B>\n  内心: "结束了。”\n</B>', ['B'], { fixSmartQuotes: false }).fixes.length === 0);
let yamlProof2 = null;
try {
    const jsyaml = (await import('js-yaml')).default;
    const raw = '状态栏:\n  用户列表:\n    - 用户:\n        名字: "染"\n        内心: 他说: 我要走了\n';
    let before = 'ok';
    try { jsyaml.load(raw); } catch (_) { before = 'fail'; }
    const fixed = guardBlockYaml('<B>\n' + raw + '</B>', ['B']).text.replace(/^<B>\n/, '').replace(/<\/B>$/, '');
    let after = 'ok';
    try { const p = jsyaml.load(fixed); after = (p && p['状态栏'] && Array.isArray(p['状态栏']['用户列表']) && p['状态栏']['用户列表'].length) ? 'ok' : 'no-list'; } catch (_) { after = 'fail'; }
    yamlProof2 = { before, after };
} catch (_) { yamlProof2 = null; }
check('js-yaml 端到端：裸「: 」值修复前解析失败、修复后能取出用户列表', !yamlProof2 || (yamlProof2.before === 'fail' && yamlProof2.after === 'ok'), yamlProof2);

console.log('— 夹具 13：结构块严格 YAML 校验（注入 js-yaml，模拟扩展自带的 vendor）');
let jsyamlLib = null;
try { jsyamlLib = (await import('js-yaml')).default; } catch (_) { jsyamlLib = null; }
const goodText = '<B>\n状态栏:\n  用户列表:\n    - 用户:\n        名字: "染"\n</B>';
const badText = '<B>\n  内心: 他说: 我要走了\n</B>';
check('没有 yamlLib 时明确返回 checked=false', strictYamlCheck(goodText, ['B'], null).checked === false);
if (jsyamlLib) {
    const okRes = strictYamlCheck(goodText, ['B'], jsyamlLib);
    check('正常块：checked=true 且 1 个块 0 问题', okRes.checked === true && okRes.blocks === 1 && okRes.issues.length === 0, okRes);
    const badRes = strictYamlCheck(badText, ['B'], jsyamlLib);
    check('裸「: 」值：严格校验报出 1 条问题', badRes.issues.length === 1 && /mapping|nested|column/i.test(badRes.issues[0].error || ''), badRes);
    const repaired = guardBlockYaml(badText, ['B']).text;
    check('先启发式修复 → 严格校验通过', strictYamlCheck(repaired, ['B'], jsyamlLib).issues.length === 0, repaired);
    check('无结构块时 blocks=0', strictYamlCheck('正文没有块', ['B'], jsyamlLib).blocks === 0);
} else {
    check('本机没有 js-yaml，跳过严格校验断言', true);
}

console.log('— 夹具 14：未声明结构块清理（实测：模型把世界书回显成 <world_setting>、自创 <status_block>）');
const prof14 = buildProfile({ regex_scripts: [{ scriptName: '美化', findRegex: '/<正文>(.*?)<\/正文>.*?<女主A_名字>(.*?)<\/女主A_名字>/s', replaceString: '<div>$1</div>' }] });
const dec14 = new Set([...(prof14.anchors || []), ...(prof14.dataTags || []), ...(prof14.rawTags || [])]);
const real14 = '<正文>正文</正文>\n<女主A_名字>雾子</女主A_名字>\n<world_setting>世界书原文…</world_setting>\n<status_block>x</status_block>\n<konatan_planning~>内部思考</konatan_planning~>\n<tucao>吐槽</tucao>\n<options>1. …</options>\n<div>界面</div>';
const s14 = stripUndeclaredBlocks(real14, { declared: dec14, keep: KEEP_BLOCKS });
check('删掉 3 个未声明块', s14.removed.length === 3 && ['world_setting', 'status_block', 'konatan_planning~'].every((t) => !s14.text.includes(t)), s14.removed);
check('本卡声明的标签(含中文)保留', s14.text.includes('<正文>') && s14.text.includes('女主A_名字'), s14.text);
check('预设块与通用 HTML 保留', s14.text.includes('<tucao>') && s14.text.includes('<options>') && s14.text.includes('<div>'));
const s14b = stripUndeclaredBlocks('<world_setting>没闭合的一段', { declared: dec14 });
check('不成对的块只报告不删', s14b.removed.length === 0 && s14b.unclosed.includes('world_setting'), s14b);
const decAll = new Set([...dec14, 'world_setting', 'status_block', 'konatan_planning~']);
check('卡声明过的块不会被误删', stripUndeclaredBlocks(real14, { declared: decAll }).removed.length === 0);
check('清理后卡的正则仍能匹配', /<正文>([\s\S]*?)<\/正文>/.test(s14.text), s14.text.slice(0, 60));
console.log('— 夹具 15：变量块兜底（抽取 / 校验 / 提示词）');
const uvOne = '<UpdateVariable><Analysis>x</Analysis><JSONPatch>[{"op":"replace","path":"/系统/时间","value":"15:30"}]</JSONPatch></UpdateVariable>';
const ex15 = extractUpdateBlock('正文内容' + String.fromCharCode(10) + uvOne);
check('抽出变量块与补丁正文', !!ex15 && ex15.patchText.indexOf('/系统/时间') >= 0, ex15 && ex15.patchText.slice(0, 40));
check('没有变量块 → null', extractUpdateBlock('纯正文') === null);
check('缺结束标签 → null', extractUpdateBlock('<UpdateVariable><JSONPatch>[]</JSONPatch>') === null);
check('合法补丁通过且操作数正确', (() => { const v = validatePatchBlock(ex15.block); return v.ok && v.ops === 1; })(), validatePatchBlock(ex15.block));
check('裸数组也认', validatePatchBlock('[{"op":"delta","path":"/a","value":1}]').ok === true);
check('坏 JSON 报问题', validatePatchBlock('<JSONPatch>not json</JSONPatch>').problems.length > 0);
check('空数组算失败', validatePatchBlock('<JSONPatch>[]</JSONPatch>').ok === false);
check('缺 path 算失败', validatePatchBlock('[{"op":"replace"}]').ok === false);
const pOK = buildVarFixPrompt({ varSpec: 'FORMAT-HERE', required: [{ path: '系统.时间' }], messageText: '他把门推开了。', lastUserText: '我推门' });
check('提示词带格式/字段/回复/玩家输入', pOK.indexOf('FORMAT-HERE') >= 0 && pOK.indexOf('系统.时间') >= 0 && pOK.indexOf('他把门推开了') >= 0 && pOK.indexOf('我推门') >= 0, pOK.length);
const pStrict = buildVarFixPrompt({ strict: true, messageText: 'x' });
check('严格版更短且只要 JSONPatch', pStrict.length < pOK.length && pStrict.indexOf('只输出') >= 0, [pOK.length, pStrict.length]);
check('超长正文被截断', buildVarFixPrompt({ messageText: 'x'.repeat(9000), maxChars: 1000 }).length < 1400);
console.log('— 夹具 16：模板组展开与变量路径白名单（P2 ⑤）');
const DOL = String.fromCharCode(36);
const NL = String.fromCharCode(10);
check('单组展开', expandTemplateGroups(['系统.' + DOL + '{日期|时间}']).join() === '系统.日期,系统.时间');
const multi16 = expandTemplateGroups([DOL + '{角色A|角色B}.好感.' + DOL + '{妆容|表情}']);
check('两组同时展开 → 4 条', multi16.length === 4 && multi16.indexOf('角色B.好感.表情') >= 0, multi16);
check('无模板组时去重返回', expandTemplateGroups(['a', 'a']).join() === 'a');
check('点号/斜杠归一', normalizePath('系统.日期') === '/系统/日期' && normalizePath('/林婉婷/好感') === '/林婉婷/好感', [normalizePath('系统.日期'), normalizePath('/林婉婷/好感')]);
const rules16 = ['---', '变量更新规则:', '  系统:', '    日期:', '      check:', '        - 场景跳转后更新', '  林婉婷:', '    好感:', '      check:', '        - 好感度变化时更新'].join(NL) + NL + '示例：' + NL + "_.set('林婉婷.心情', '平静');" + NL + '路径: /系统/时间' + NL + '"path": "/林婉婷/好感"';
const allow16 = extractAllowedPaths([{ content: rules16 }]);
check('白名单含缩进字段', allow16.paths.indexOf('/系统/日期') >= 0 && allow16.paths.indexOf('/林婉婷/好感') >= 0, allow16.paths);
check('白名单含显式路径与示例代码', allow16.paths.indexOf('/林婉婷/心情') >= 0 && allow16.paths.indexOf('/系统/时间') >= 0, allow16.paths);
check('生成上级前缀', allow16.prefixes.indexOf('/林婉婷') >= 0 && allow16.prefixes.indexOf('/系统') >= 0, allow16.prefixes);
console.log('— 夹具 17：补丁路径白名单校验（P2 ⑤）');
const patch17 = '<JSONPatch>[{"op":"replace","path":"/系统/时间","value":"16:00"},{"op":"delta","path":"/林婉婷/好感","value":5},{"op":"replace","path":"/系统/心情","value":"好奇"},{"op":"replace","path":"/无关角色/好感","value":1}]</JSONPatch>';
const v17 = validatePatchPaths(patch17, allow16);
check('声明路径判为已知', v17.known.length === 2 && v17.known.indexOf('/系统/时间') >= 0 && v17.known.indexOf('/林婉婷/好感') >= 0, v17.known);
check('组内未声明子路径判为额外（放行但要提示）', v17.extra.indexOf('/系统/心情') >= 0, v17.extra);
check('凭空新根判为未知', v17.ok === false && v17.unknown.length === 1 && v17.unknown[0].path === '/无关角色/好感', v17.unknown);
const v17b = validatePatchPaths(patch17, { paths: ['/系统/*'], prefixes: [], wildcards: ['/系统/*'] });
check('通配 /系统/* 只放行 /系统 下级', v17b.known.join() === '/系统/时间,/系统/心情' && v17b.unknown.map((u) => u.path).join() === '/林婉婷/好感,/无关角色/好感', v17b);
check('未声明 /无关角色 时 unknown', v17b.unknown.map((u) => u.path).indexOf('/无关角色/好感') >= 0, v17b.unknown.map((u) => u.path));
check('空白名单 → checked:false 不误报', validatePatchPaths(patch17, { paths: [] }).checked === false);
check('写上级路径放行', validatePatchPaths('<JSONPatch>[{"op":"replace","path":"/系统","value":1}]</JSONPatch>', allow16).ok === true);
console.log('— 夹具 18：多块记账（P2 ⑦）');
const two18 = '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/系统/日期","value":"2"}]</JSONPatch></UpdateVariable>' + NL + uvOne;
check('一条回复里抽出 2 个变量块', extractUpdateBlocks(two18).length === 2);
const req18 = [{ path: '系统.日期' }, { path: '系统.时间' }];
const cov18 = patchCoverage(two18, req18);
check('覆盖度跨多块统计', cov18.blocks === 2 && cov18.covered.length === 2 && cov18.missing.length === 0, cov18);
check('记录模型实际写过的路径', cov18.written.indexOf('/系统/时间') >= 0 && cov18.written.indexOf('/系统/日期') >= 0, cov18.written);
const bp18 = blockPresence(two18 + NL + '<StatusBar>x</StatusBar>', ['UpdateVariable', 'StatusBar']);
check('块出现次数记账', bp18.blocks[0].pairs === 2 && bp18.duplicates.length === 1 && bp18.blocks[1].pairs === 1, bp18.blocks);
const bp18b = blockPresence('<T/>' + NL + '<T/>', ['T']);
check('自闭合占位符重复也能记账', bp18b.blocks[0].selfs === 2 && bp18b.blocks[0].extra === 1, bp18b.blocks);
const ops18 = parsePatchOps('<JSONPatch>[{"op":"replace","path":"/a"}]</JSONPatch>' + '<JSONPatch>[{"op":"delta","path":"/b","value":1}]</JSONPatch>');
check('多个 JSONPatch 片段全部解析', ops18.ops.length === 2 && ops18.frags === 2, ops18);
check('单片段解析仍正确', parsePatchOps('<JSONPatch>[{"op":"replace","path":"/a"}]</JSONPatch>').ops.length === 1, parsePatchOps('<JSONPatch>[{"op":"replace","path":"/a"}]</JSONPatch>').ops.length);
console.log('— 夹具 19：入口顺序回归（0.2.6/0.2.7 的清理逻辑被插错函数）');
const idxSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
const gStart = idxSrc.indexOf('function guardMessage(');
const sStart = idxSrc.indexOf('async function strictCheckMessage(');
const sEnd = idxSrc.indexOf('function mvuApi()');
const gEnd = idxSrc.indexOf('function verifyRendered(');
check('三个区块都能定位', gStart > 0 && sStart > 0 && sEnd > sStart && gEnd > gStart, [gStart, sStart, sEnd, gEnd]);
check('stripUndeclaredBlocks 落在 guardMessage 内', idxSrc.slice(gStart, gEnd).indexOf('stripUndeclaredBlocks(') > 0);
check('stripUndeclaredBlocks 不再出现在 strictCheckMessage 内', idxSrc.slice(sStart, sEnd).indexOf('stripUndeclaredBlocks(') < 0);
check('guardMessage 先算 base 再 guardText', idxSrc.slice(gStart, gEnd).indexOf('guardText(base, profile, s)') > 0);
check('版本号与 manifest 一致', readFileSync(new URL('../extensions/card-compat/manifest.json', import.meta.url), 'utf8').indexOf('"0.3.3"') > 0 && idxSrc.indexOf("const VERSION = '0.3.3'") > 0);
function STRINGS_ZH_HAS(k) { return idxSrc.indexOf(k + "'") > 0; }
console.log('— 夹具 20：重渲染后补发事件（0.2.9：修「刷新页面状态栏才变回面板」）');
const nudgeIdx = idxSrc.indexOf('function nudgeRender(');
const nudgeBody = nudgeIdx >= 0 ? idxSrc.slice(nudgeIdx, nudgeIdx + 900) : '';
check('存在 nudgeRender()', nudgeIdx > 0);
check('补发的是酒馆助手真正监听的 MESSAGE_UPDATED', nudgeBody.indexOf('event_types.MESSAGE_UPDATED') > 0, nudgeBody.slice(0, 120));
check('补发受开关控制（关掉就不发）', nudgeBody.indexOf('s.nudgeRender === false') > 0);
check('两处重渲染（guardMessage / maybeFixVars）后都补发', (idxSrc.match(/nudgeRender\(messageId\)/g) || []).length >= 2, (idxSrc.match(/nudgeRender\(messageId\)/g) || []).length);
check('历史楼不重渲染、最新楼重渲染', idxSrc.indexOf('guardMessage(idx, { rerender: rerenderOld || idx === total - 1 })') > 0);
check('默认不重渲染历史楼（不拆已画好的状态栏）', /rerenderOldFloors: false/.test(idxSrc));
check('默认开启补发', /nudgeRender: true/.test(idxSrc));
check('面板给了两个开关', idxSrc.indexOf("cb('cc-nudge-render', 'nudgeRender')") > 0 && idxSrc.indexOf("bind('cc-rerender-old', 'rerenderOldFloors', true)") > 0);
check('中英文案都补齐', !!STRINGS_ZH_HAS('nudgeRender') && !!STRINGS_ZH_HAS('rerenderOld'), 'nudgeRender/rerenderOld');
console.log('— 夹具 21：YAML 结构级修复（实测：天狐3 卡弹「YAML格式错误: bad indentation of a mapping entry」）');
const broken21 = [
  '<Status_block>',
  '状态栏:',
  '  地点: "📍 青溪镇外 白桦林"',
  '  用户列表:',
  '    - 用户: "👤 涂山清璃 "',
  '        行动: "被请求抱抱后身体侧倾。"',
  '        穿搭: "长裙堆叠。", 衬衫由于贴合而产生褶皱。',
  '    - 用户: "👤 染 "',
  '        行动: "上前两步发出邀请。"',
  '  行动选项:',
  '    - "1. 选项一"',
  '    - "2. 选项二"',
  '</Status_block>',
].join(NL);
const r21 = repairYamlStructure(broken21, ['Status_block']);
check('修出 3 处：两个列表项下沉 + 一处逗号并回', r21.fixes.length === 3 && r21.fixes.filter((f) => f.kind === 'list-inline-demote').length === 2 && r21.fixes.some((f) => f.kind === 'trailing-text-merged'), r21.fixes);
check('行内标量下沉为「名字」子键', r21.text.includes('    - 用户:') && r21.text.includes('        名字: "👤 涂山清璃 "') && !r21.text.includes('- 用户: "'), r21.text.split(NL).slice(3, 8));
check('逗号后的文字并回引号内', r21.text.includes('穿搭: "长裙堆叠。衬衫由于贴合而产生褶皱。"'), r21.text);
check('普通字符串列表项不动', r21.text.includes('    - "1. 选项一"'));
const r21b = repairYamlStructure('<T>' + NL + '  - 用户: "A"' + NL + '      名字: "B"' + NL + '      行动: "C"' + NL + '</T>', ['T']);
check('兄弟键已有名字类键 → 只删冗余标量', r21b.text.includes('- 用户:') && !r21b.text.includes('- 用户: "A"') && r21b.fixes[0].kind === 'list-inline-drop', r21b);
const clean21 = '<T>' + NL + '状态栏:' + NL + '  用户列表:' + NL + '    - 用户:' + NL + '        名字: "X"' + NL + '</T>';
check('本来就合法的块一处都不动', repairYamlStructure(clean21, ['T']).fixes.length === 0);
check('块外正文不动', repairYamlStructure('正文 - 用户: "X"' + NL, ['T']).fixes.length === 0);
let jsyaml21 = null;
try { jsyaml21 = (await import('js-yaml')).default; } catch (_) {}
if (jsyaml21) {
  const inner21 = (t) => t.replace('<Status_block>', '').replace('</Status_block>', '');
  let before21 = 'ok';
  try { jsyaml21.load(inner21(broken21)); } catch (_) { before21 = 'fail'; }
  const p21 = jsyaml21.load(inner21(r21.text));
  const u21 = p21['状态栏']['用户列表'][0]['用户'];
  check('js-yaml 端到端：修复前解析失败', before21 === 'fail', before21);
  check('修复后 用户列表[0].用户 是对象且带名字（卡的契约）', !!u21 && typeof u21 === 'object' && typeof u21['名字'] === 'string' && typeof u21['行动'] === 'string', u21);
  check('修复后仍是 2 个用户、2 条选项', p21['状态栏']['用户列表'].length === 2 && p21['状态栏']['行动选项'].length === 2, Object.keys(p21['状态栏']));
} else { check('本机没有 js-yaml，跳过端到端断言', true); }
console.log('— 夹具 22：扩展信息 / 更新日志弹窗（0.3.1）');
const BT22 = String.fromCharCode(96);
const F22 = BT22 + BT22 + BT22;
const md22 = ['# 标题一', '## 版本节', '', '- 条目 A', '- 条目 **加粗** 与 ' + BT22 + '代码' + BT22, '', '> 引用行', '', '---', '', F22, '<script>alert(1)</script>', F22].join(NL);
const h22 = renderChangelogMarkdown(md22);
check('标题渲染', h22.indexOf('<h1>标题一</h1>') >= 0 && h22.indexOf('<h2>版本节</h2>') >= 0, h22.slice(0, 80));
check('列表 + 粗体 + 行内代码', h22.indexOf('<ul>') >= 0 && h22.indexOf('<li>条目 <b>加粗</b> 与 <code>代码</code></li>') >= 0, h22);
check('引用块', h22.indexOf('<blockquote>') >= 0 && h22.indexOf('<p>引用行</p>') >= 0);
check('分隔线', h22.indexOf('<hr>') >= 0);
check('围栏里的 HTML 被转义（不会执行）', h22.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') >= 0 && h22.indexOf('<script>') < 0, h22.slice(-200));
check('普通一行也包成段落', renderChangelogMarkdown('就一行').indexOf('<p>就一行</p>') >= 0);
check('空 / null 输入不炸', renderChangelogMarkdown('') === '' && renderChangelogMarkdown(null) === '');
check('扩展信息默认折叠成一行按钮（ⓘ 扩展信息）', idxSrc.indexOf('id="cc-info-toggle"') > 0 && idxSrc.indexOf('id="cc-info-body" class="cc-info-body" style="display:none"') > 0);
check('展开状态记进设置（infoOpen）', idxSrc.indexOf('st2.infoOpen') > 0 && idxSrc.indexOf('function applyInfoOpen()') > 0);
check('「查看日志」按钮在信息卡里', idxSrc.indexOf('id="cc-info-log"') > 0);
check('日志读扩展目录里的 CHANGELOG.md（离线可用）', idxSrc.indexOf("new URL('./CHANGELOG.md', import.meta.url)") > 0);
check('用 ST 原生 popup 展示', idxSrc.indexOf('callGenericPopup(') > 0 && idxSrc.indexOf('POPUP_TYPE.TEXT') > 0);
check('对外钩子暴露 changelog()', idxSrc.indexOf('changelog: () => showChangelog()') > 0);
check('信息块含作者/许可/免费声明', idxSrc.indexOf('infoAuthor') > 0 && idxSrc.indexOf('infoNote') > 0);
console.log('');
console.log('结果: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
