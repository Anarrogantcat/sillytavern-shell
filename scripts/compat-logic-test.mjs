// scripts/compat-logic-test.mjs — card-compat 逻辑层夹具断言（不依赖 ST/Electron）
import { readFileSync } from 'node:fs';
import { repairYamlStructure, renderChangelogMarkdown, detectVariableProtocol, extractSetPaths, coverageByProtocol, scanCardCompatibility, normalizeRegexForTags, tagsOfLoose, detectFrontEndViews, anchoredViewConsuming, regexFromFindRegex, classifyNoRules, repairBracketTags } from '../extensions/card-compat/logic.js';
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
const ccManifestVer = JSON.parse(readFileSync(new URL('../extensions/card-compat/manifest.json', import.meta.url), 'utf8')).version;
const ccIdxVer = (idxSrc.match(/const VERSION = '([^']+)'/) || [])[1];
check('版本号与 manifest 一致（动态比对，不再写死）', String(ccManifestVer) === String(ccIdxVer) && idxSrc.indexOf("const VERSION = '" + ccManifestVer + "'") > 0, 'manifest=' + ccManifestVer + ' index.js=' + ccIdxVer);
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
console.log('— 夹具 23：变量协议识别 + 按协议覆盖度 + 兼容模式（0.4.0）');
const pMvu = detectVariableProtocol({ text: '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>', dataTags: ['UpdateVariable'], blockTags: ['UpdateVariable'] });
check('识别 MVU 协议（可写回）', pMvu.id === 'mvu' && pMvu.canWriteBack === true, pMvu);
const pJp = detectVariableProtocol({ text: '<Foo><JSONPatch>[{"op":"replace","path":"/a"}]</JSONPatch></Foo>', dataTags: ['Foo'], blockTags: ['Foo'] });
check('识别任意标签内的 JSONPatch', pJp.id === 'jsonpatch' && pJp.canWriteBack === true, pJp);
const pYaml = detectVariableProtocol({ text: '状态栏:' + NL + '  地点: "青云镇"', dataTags: [], blockTags: ['Status_block'] });
check('识别 YAML 结构块（天狐3 那类）', pYaml.id === 'yaml-block' && pYaml.canWriteBack === false, pYaml);
const pSet = detectVariableProtocol({ text: "_.set('角色.好感', 10);", blockTags: [] });
check('识别 _.set 写法（不可写回）', pSet.id === 'lodash-set' && pSet.canWriteBack === false, pSet);
check('识别 setvar 宏', detectVariableProtocol({ text: '{{setvar::好感::10}}' }).id === 'setvar-macro');
check('普通正文 -> none（面板会收起变量开关）', detectVariableProtocol({ text: '就是一段普通正文' }).id === 'none');
const setPaths = extractSetPaths("_.set('角色.好感', 1); _.set('/系统/时间', '2')");
check('extractSetPaths 归一路径', setPaths.join() === '/角色/好感,/系统/时间', setPaths);
const covSet = coverageByProtocol("_.set('角色.好感', 1);", [{ path: '角色.好感' }, { path: '角色.心情' }], { id: 'lodash-set' });
check('_.set 协议下覆盖度正确', covSet.covered.join() === '角色.好感' && covSet.missing.join() === '角色.心情' && covSet.kind === 'lodash-set', covSet);
const covMvu = coverageByProtocol('<UpdateVariable><JSONPatch>[{"op":"replace","path":"/角色/好感","value":1}]</JSONPatch></UpdateVariable>', [{ path: '角色.好感' }], { id: 'mvu' });
check('MVU 协议下覆盖度仍按补丁路径', covMvu.covered.length === 1 && covMvu.written.join() === '/角色/好感', covMvu);
check('面板有依赖状态块与变量协议行', idxSrc.indexOf('id="cc-dep"') > 0 && idxSrc.indexOf('id="cc-proto"') > 0);
check('兼容模式开关存在且默认关', /compatMode: false/.test(idxSrc) && idxSrc.indexOf("bind('cc-compat-mode', 'compatMode', true)") > 0);
check('兼容模式跳过补发事件 / MVU 试解析 / 自动补变量', /s.nudgeRender === false \|\| s.compatMode/.test(idxSrc) && /!s.mvuVerify \|\| s.compatMode/.test(idxSrc) && /!s.autoFixVars \|\| s.compatMode/.test(idxSrc));
check('补发事件后有自检（未渲染记 nudge-missed）', idxSrc.indexOf('checkNudgeApplied(messageId)') > 0 && idxSrc.indexOf("'nudge-missed'") > 0);
check('依赖探测读酒馆助手 manifest', idxSrc.indexOf("/scripts/extensions/third-party/") > 0);
check('对外钩子暴露 protocol/compatMode/deps', idxSrc.indexOf('protocol: () => profileOf().protocol') > 0 && idxSrc.indexOf('compatMode: () => settings()?.compatMode === true') > 0 && idxSrc.indexOf('deps: (f) => depStatus(!!f)') > 0);
console.log('— 夹具 24：兼容性体检（0.5.0）');
const mk24 = (name, data) => ({ name: name, data: data });
const scanAnchor = { extensions: { regex_scripts: [{ scriptName: '状态栏', findRegex: '<StatusPlaceHolderImpl/>', replaceString: '<div>x</div>' }] } };
const scanMvuRule = { character_book: { entries: [{ comment: '[mvu_update]变量更新规则', content: '变量更新规则:' + NL + '  系统:' + NL + '    日期:' + NL + '      check:' + NL + '        - 场景跳转后更新' }] } };
const scanDataNoRule = { extensions: { regex_scripts: [{ scriptName: '去变量更新', findRegex: '/<UpdateVariable>.*?<\\/UpdateVariable>/gms', replaceString: '' }] } };
const scanFmtOnly = { extensions: { regex_scripts: [{ scriptName: '美化', findRegex: '/AAA(.*?)AAA/s', replaceString: '<正文>$1</正文>' }] } };
const scanHelper = { extensions: { tavern_helper: { scripts: [{ name: '状态栏', content: 'render()' }] } } };
const scanPlain = { name: '纯正文卡' };
const cards24 = [
  mk24('MVU卡', Object.assign({}, scanAnchor, scanDataNoRule, scanMvuRule)),
  mk24('只有锚点', scanAnchor),
  mk24('有变量块无规则', scanDataNoRule),
  mk24('只有格式标签', scanFmtOnly),
  mk24('靠助手脚本', scanHelper),
  mk24('纯正文', scanPlain),
];
const scan24 = scanCardCompatibility(cards24);
check('体检总数正确', scan24.summary.total === 6, scan24.summary.total);
check('逐卡结论：MVU卡=ok / 只有锚点=guard-only / 无规则=no-rules', scan24.rows[0].verdict === 'ok' && scan24.rows[1].verdict === 'guard-only' && scan24.rows[2].verdict === 'no-rules', scan24.rows.map((r) => r.verdict));
check('格式标签卡=format-only / 助手卡=helper-only / 纯正文=plain', scan24.rows[3].verdict === 'format-only' && scan24.rows[4].verdict === 'helper-only' && scan24.rows[5].verdict === 'plain', scan24.rows.slice(3).map((r) => r.verdict));
check('协议直方图含 mvu/none', (scan24.summary.protocol.mvu || 0) >= 1 && (scan24.summary.protocol.none || 0) >= 1, scan24.summary.protocol);
check('能力计数：可守护 3 / 可写回 2 / 有规则 1', scan24.summary.guardable === 3 && scan24.summary.writable === 2 && scan24.summary.rules === 1, scan24.summary);
check('每行带名字/协议/锚点/规则字段', scan24.rows.every((r) => typeof r.name === 'string' && typeof r.protocol === 'string' && typeof r.anchors === 'number' && typeof r.required === 'number'));
check('空列表不炸', scanCardCompatibility([]).summary.total === 0 && scanCardCompatibility(null).summary.total === 0);
check('体检面板接线（按钮/表格/筛选/钩子）', idxSrc.indexOf('id="cc-scan-run"') > 0 && idxSrc.indexOf('id="cc-scan-rows"') > 0 && idxSrc.indexOf('data-scan-filter') > 0 && idxSrc.indexOf('scan: (cards) => scanCardCompatibility') > 0);
check('格式标签缺失只提示不改写', idxSrc.indexOf("'format-tag-missing'") > 0 && /formatMissing/.test(idxSrc));

console.log('— 夹具 25：正则转义锚点 + 动态状态栏（0.6.0）');
// ① findRegex 归一化：/<Tag\s*\/>/g 这种写法必须也能把标签抽出来
const nz1 = normalizeRegexForTags('/<StatusPlaceHolderImpl\\s*\\/>/g');
check('归一化：去定界符 + 反转义 + \\s* 折成空格', nz1 === '<StatusPlaceHolderImpl />', nz1);
check('归一化：裸标签原样保留', normalizeRegexForTags('<UpdateVariable>') === '<UpdateVariable>', normalizeRegexForTags('<UpdateVariable>'));
check('归一化：成对标签里的转义斜杠', normalizeRegexForTags('/<\\/Tag>/g') === '</Tag>', normalizeRegexForTags('/<\\/Tag>/g'));
// ② 宽松抽取：认得 <(update(?:variable)?)> 这类带正则结构的写法，排除通用 HTML
check('宽松抽取：分组写法认出 update', tagsOfLoose('<(update(?:variable)?)>').join(',') === 'update', tagsOfLoose('<(update(?:variable)?)>'));
check('宽松抽取：排除 div/script 等通用 HTML', tagsOfLoose('<div><script>').length === 0, tagsOfLoose('<div><script>'));
// ③ 实测病灶（归真纪元那张卡）：转义状态栏锚点 —— 旧实现 anchors=0，被判「只有格式标签」，AI 忘写占位符时也补不上
const escExt = { regex_scripts: [
    { scriptName: '对AI隐藏状态栏', findRegex: '/<StatusPlaceHolderImpl\\s*\\/>/g', replaceString: '', placement: [2] },
    { scriptName: '状态栏', findRegex: '/<StatusPlaceHolderImpl\\s*\\/>/g', replaceString: '<!DOCTYPE html><html><body><div>{{stat_data}}</div>' + 'x'.repeat(500) + '</body></html>', markdownOnly: true, placement: [2] },
    { scriptName: '变量更新美化', findRegex: '/<(update(?:variable)?)>[\\s\\S]*?<\\/\\1>/gsi', replaceString: '<div class="thinking-description">…</div>', markdownOnly: true, placement: [1, 2] },
] };
const escProf = buildProfile(escExt);
check('转义锚点被认出（0.5.0 这里一个都没有）', escProf.anchors.indexOf('StatusPlaceHolderImpl') >= 0, escProf.anchors);
check('锚点形态记成自闭合 self', escProf.anchorForms['StatusPlaceHolderImpl'] === 'self', escProf.anchorForms);
check('另外：<(update(?:variable)?)> 记成数据块（旧实现也漏）', escProf.dataTags.indexOf('update') >= 0, escProf.dataTags);
check('rawTags 不再混进正则/JS 片段', !(escProf.rawTags || []).some((t) => /[\\*?+(){}\[\]|]/.test(t)), escProf.rawTags);
// ③b 真正的功能后果：模型这一轮忘写占位符，card-compat 必须能把锚点补回去（0.5.0 因为锚点隐形，补不了 → 状态栏整块消失）
const g25 = guardText('这一轮模型忘了写占位符。', escProf, { injectAnchor: true, anchorStyle: 'self' });
check('模型忘写占位符 → 自动补上', g25.actions.some((a) => a.type === 'anchor-injected') && g25.text.indexOf('<StatusPlaceHolderImpl/>') >= 0, g25);
check('补出来的形态是卡要的自闭合', /\n<StatusPlaceHolderImpl\/>$/.test(g25.text), g25.text.slice(-40));
// ④ 前端界面识别：动态状态栏 / 交互面板
const views25 = detectFrontEndViews(escExt);
check('认出 1 个前端状态栏，且判定为真动态', views25.bars.length === 1 && views25.dynamic === true, views25);
check('短替换 / 空替换 / 被禁用的脚本都不算界面', detectFrontEndViews({ regex_scripts: [
    { scriptName: '状态栏', findRegex: '/<X\\/>/', replaceString: '<b>x</b>' },
    { scriptName: '剥除', findRegex: '/<X\\/>/', replaceString: '' },
    { scriptName: '状态栏（已禁用）', findRegex: '/<X\\/>/', replaceString: '<div>' + 'x'.repeat(600), disabled: true },
] }).bars.length === 0);
check('开局面板被认出（巨型 HTML + script）', detectFrontEndViews({ regex_scripts: [
    { scriptName: '[界面]自定义开局', findRegex: '/^【开局】$/', replaceString: '<!DOCTYPE html><html><body>' + 'x'.repeat(3000) + '<script>1</script></body></html>', markdownOnly: true },
] }).panels.length === 1);
// ⑤ 体检：转义锚点卡应当能守护（旧实现判 format-only）；只靠前端正则渲染状态栏、又没有锚点的卡判 dyn-bar
const rule25 = { comment: '[mvu_update]变量更新规则', content: '变量更新规则:' + NL + '  系统:' + NL + '    日期:' + NL + '      check:' + NL + '        - 场景跳转后更新' };
const scan25 = scanCardCompatibility([
    { name: '转义锚点卡', data: { first_mes: '开场' + NL + '<UpdateVariable>' + NL + '<JSONPatch>[{"op":"replace","path":"/系统/日期","value":2}]</JSONPatch>' + NL + '</UpdateVariable>', extensions: { regex_scripts: escExt.regex_scripts }, character_book: { entries: [rule25] } } },
    { name: '只有动态状态栏', data: { extensions: { regex_scripts: [
        { scriptName: '对AI隐藏状态栏', findRegex: '/<StatusPlaceHolderImpl\\s*\\/>/g', replaceString: '', placement: [2] },
        { scriptName: '状态栏渲染', findRegex: '/【状态栏】/g', replaceString: '<div class="bar">{{stat_data}}</div>' + 'x'.repeat(500), markdownOnly: true },
    ] } } },
]);
check('转义锚点卡判 ok（不再是 format-only）', scan25.rows[0].verdict === 'ok' && scan25.rows[0].anchors >= 1, scan25.rows[0]);
check('只有动态状态栏的卡判 dyn-bar', scan25.rows[1].verdict === 'dyn-bar' && scan25.rows[1].bars >= 1, scan25.rows[1]);
check('总览计入动态状态栏（含真动态数）与面板', scan25.summary.dynBars === 2 && scan25.summary.dynBarsDynamic === 2 && typeof scan25.summary.panels === 'number', scan25.summary);
check('每行带 bars / panels / dynBar 字段', scan25.rows.every((r) => typeof r.bars === 'number' && typeof r.panels === 'number' && typeof r.dynBar === 'boolean'), scan25.rows);
// ⑥ 面板接线
check('面板显示动态状态栏/交互面板，且筛选项含 dyn-bar', idxSrc.indexOf('scanDyn') > 0 && idxSrc.indexOf('scanPanel') > 0 && idxSrc.indexOf("'dyn-bar'") > 0 && idxSrc.indexOf('marks(r)') > 0);

console.log('— 夹具 26：整条消息被前端界面接管时不许改写（0.6.1；实测「开始新聊天后开局面板消失」）');
const anchoredExt = { regex_scripts: [
    { scriptName: '[界面]终端', findRegex: '/^\\s*【自定义开局】\\s*$/', replaceString: '<!DOCTYPE html><html><body>' + 'x'.repeat(3000) + '<script>1</script></body></html>', markdownOnly: true, placement: [2] },
    { scriptName: '[界面]状态栏', findRegex: '/<StatusPlaceHolderImpl\\s*\\/>/g', replaceString: '<div>{{stat_data}}</div>' + 'x'.repeat(500), markdownOnly: true, placement: [2] },
    { scriptName: '变量更新美化', findRegex: '/<(update(?:variable)?)>[\\s\\S]*?<\\/\\1>/gsi', replaceString: '<div>ok</div>', markdownOnly: true, placement: [2] },
] };
const anchoredProf = buildProfile(anchoredExt);
check('锚定面板被标成 anchored', anchoredProf.views.panels.length === 1 && anchoredProf.views.panels[0].anchored === true, anchoredProf.views.panels);
check('非锚定的状态栏不算 anchored', anchoredProf.views.bars[0].anchored === false, anchoredProf.views.bars);
const greeting26 = '【自定义开局】';
check('认出「整条消息被接管」', !!anchoredViewConsuming(anchoredProf.views, greeting26));
check('普通正文不误判（同样含这几个字）', anchoredViewConsuming(anchoredProf.views, '正文里提到【自定义开局】但后面还有别的内容') === null);
const g26 = guardText(greeting26, anchoredProf, { injectAnchor: true, anchorStyle: 'self' });
check('问候语原样返回，不再补锚点', g26.text === greeting26 && g26.actions.some((a) => a.type === 'anchored-view-skip'), g26);
check('面板正则仍能匹配（这就是面板消失的根因）', regexFromFindRegex(anchoredExt.regex_scripts[0].findRegex).test(g26.text));
const g26b = guardText('这是模型的一轮正常回复。', anchoredProf, { injectAnchor: true, anchorStyle: 'self' });
check('普通回复照样补锚点（没回退）', g26b.text.indexOf('<StatusPlaceHolderImpl/>') >= 0 && g26b.actions.some((a) => a.type === 'anchor-injected'), g26b);
check('regexFromFindRegex：保留 i/s 但去掉 g', (function () { const rx = regexFromFindRegex('/abc/gsi'); return rx && rx.flags.indexOf('g') < 0 && rx.flags.indexOf('i') >= 0 && rx.flags.indexOf('s') >= 0; })());
check('对话入口接线：guardMessage 先判整条接管', idxSrc.indexOf('anchoredViewConsuming(profile.views, base)') > 0 && idxSrc.indexOf("'anchored-view-skip'") > 0);

console.log('— 夹具 27：check 的三种写法 + 「为什么没有规则」分类（0.7.0）');
// ① check: + 缩进列表（一直支持）
const rk1 = extractRequiredFields([{ comment: '[mvu_update]变量更新规则', content: '变量更新规则:' + NL + '  系统:' + NL + '    日期:' + NL + '      check:' + NL + '        - 场景跳转后更新' }], 10);
check('① check: + 缩进列表仍可用', rk1.length === 1 && rk1[0].path === '系统.日期', rk1);
// ② check: 同行条件（实测「蛊」）
const rk2 = extractRequiredFields([{ comment: '[mvu_update]变量更新规则', content: '变量更新规则:' + NL + '  主角数据:' + NL + '    银两:' + NL + '      type: number' + NL + '      check: 每次购买道具时变动。' }], 10);
check('② check: 同行条件能抽出（0.6.x 是 0 条）', rk2.length === 1 && rk2[0].path === '主角数据.银两' && rk2[0].check.indexOf('每次购买道具') >= 0, rk2);
// ③ 行内对象（实测「欲妈群」）
const rk3 = extractRequiredFields([{ comment: '[mvu_update]变量更新规则', content: '变量更新规则:' + NL + '  元数据:' + NL + '    小时: { type: number, range: 0~23, check: 跨日时归零联动 }' + NL + '    回合: { type: number, check: 每轮+1 }' }], 10);
check('③ 行内对象里的 check 能抽出（0.6.x 是 0 条）', rk3.length === 2 && rk3[0].path === '元数据.小时' && rk3[1].path === '元数据.回合', rk3);
check('③ 条件到逗号/右花括号为止，不夹带 type', rk3[0].check === '跨日时归零联动', rk3[0]);
// ④ 竖线块标量：条件在下面的缩进行里
const rk4 = extractRequiredFields([{ comment: '[mvu_update]变量更新规则', content: '变量更新规则:' + NL + '  世界:' + NL + '    天气:' + NL + '      check: |' + NL + '        - 每轮根据剧情更新' + NL + '        - 不能凭空变化' }], 10);
check('④ check: 竖线块标量取下面的缩进行', rk4.length === 1 && rk4[0].check.indexOf('每轮根据剧情更新') >= 0, rk4);
// ⑤ 三种写法混在一张卡里
const rk5 = extractRequiredFields([{ comment: '[mvu_update]变量更新规则', content: '变量更新规则:' + NL + '  A:' + NL + '    甲:' + NL + '      check:' + NL + '        - 列表条件' + NL + '    乙:' + NL + '      check: 同行条件' + NL + '    丙: { check: 行内条件 }' }], 10);
check('⑤ 三种写法混在一张卡里全部抽到', rk5.length === 3 && rk5.map((x) => x.path).join(',') === 'A.甲,A.乙,A.丙', rk5);
// ⑥ 「为什么没有规则」分类
check('分类：有 check 却没抽到 → check-unparsed', classifyNoRules([{ content: 'check: 条件' }], {}) === 'check-unparsed');
check('分类：命令式规则', classifyNoRules([{ content: '用 _.set(path, new) 修改' }], {}) === 'command');
check('分类：只有 paths 白名单', classifyNoRules([{ content: 'paths:' + NL + '  /a/b' }], {}) === 'paths');
check('分类：只有变量结构', classifyNoRules([{ content: '变量结构:' + NL + '  世界:' }], {}) === 'structure');
check('分类：规则写成散文', classifyNoRules([{ comment: '[mvu_update]变量更新规则', content: '变量更新规则: 在回复最后根据剧情判断' + '是否需要更新，随剧情自然变化。'.repeat(20) }], {}) === 'prose');
check('分类：规则在 schema 脚本里', classifyNoRules([], { tavern_helper: { scripts: [{ content: 'registerMvuSchema(z.object({ 世界: z.object({}) }))' }] } }) === 'schema');
check('分类：世界书里根本没有规则', classifyNoRules([], {}) === 'none');
// ⑦ 体检：只有「有数据块但抽不到规则」的卡才带 ruleStyle
const proseRule = { comment: '[mvu_update]变量更新规则', content: '变量更新规则: 在回复最后根据剧情判断' + '是否需要更新，随剧情自然变化。'.repeat(20) };
const scan27 = scanCardCompatibility([
    { name: '有数据块无规则-散文', data: { extensions: Object.assign({}, scanDataNoRule.extensions), character_book: { entries: [proseRule] } } },
    { name: '纯正文卡', data: { first_mes: '你好' } },
    { name: '有规则', data: { extensions: Object.assign({}, scanDataNoRule.extensions), character_book: { entries: [rule25] } } },
]);
check('⑦ 只有 no-rules 的卡带 ruleStyle', scan27.rows[0].verdict === 'no-rules' && scan27.rows[0].ruleStyle === 'prose' && !scan27.rows[1].ruleStyle && !scan27.rows[2].ruleStyle, scan27.rows.map((x) => x.verdict + ':' + x.ruleStyle));
check('⑦ 总览带无规则原因直方图', scan27.summary.noRulesStyles.prose === 1, scan27.summary.noRulesStyles);
// ⑧ 上限放开：规则多的卡不再只算前 10 条
const many27 = '变量更新规则:' + NL + Array.from({ length: 25 }).map((z, i) => '  G:' + NL + '    F' + i + ':' + NL + '      check: 条件' + i).join(NL);
const manyOut = extractRequiredFields([{ comment: '变量更新规则', content: many27 }], 200);
check('⑧ 25 条规则全部抽出（上限已放开到 200）', manyOut.length === 25, manyOut.length);
check('⑨ 面板显示无规则原因', idxSrc.indexOf('scanNoRules') > 0 && idxSrc.indexOf('rs_prose') > 0 && idxSrc.indexOf('noRulesStyles') > 0 && idxSrc.indexOf('rsLabel(r.ruleStyle)') > 0);

console.log('— 夹具 28：标签括号错乱修复（0.8.0；实测「图片丢失」那条消息）');
const TAGS28 = ['NSFW_IMG', 'StatusBar', 'options'];
// ① 实测病灶：模型把开标签的 < 写成了全角【
const b1 = repairBracketTags('【NSFW_IMG>她压在我身上/美咲_5.jpg</NSFW_IMG>', TAGS28);
check('① 【Tag> 开标签改回 <Tag>（图片丢失的直接原因）', b1.text === '<NSFW_IMG>她压在我身上/美咲_5.jpg</NSFW_IMG>' && b1.fixed.join(',') === 'NSFW_IMG', b1);
// ② 其它三种错乱形态
check('② [Tag> 也能修', repairBracketTags('[NSFW_IMG>a.jpg</NSFW_IMG]', TAGS28).text === '<NSFW_IMG>a.jpg</NSFW_IMG>');
check('③ 【Tag】…【/Tag】 两边都修（因为存在方括号闭标签）', repairBracketTags('【NSFW_IMG】a.jpg【/NSFW_IMG】', TAGS28).text === '<NSFW_IMG>a.jpg</NSFW_IMG>');
check('④ </Tag】 闭标签改回 </Tag>', repairBracketTags('<NSFW_IMG>a.jpg</NSFW_IMG】', TAGS28).text === '<NSFW_IMG>a.jpg</NSFW_IMG>');
// ⑤ 不能误伤：裸方括号、未声明标签、普通正文
check('⑤ 裸 [Tag] 不动（怕误伤正文方括号）', repairBracketTags('[NSFW_IMG] a.jpg', TAGS28).text === '[NSFW_IMG] a.jpg' && repairBracketTags('[NSFW_IMG] a.jpg', TAGS28).fixed.length === 0);
check('⑤ 未声明的标签不动', repairBracketTags('【XX_YY>abc</XX_YY>', TAGS28).text === '【XX_YY>abc</XX_YY>');
check('⑤ 普通正文原样返回', (function () { const r = repairBracketTags('他按下 [选项] 按钮，然后【说道】。', TAGS28); return r.text === '他按下 [选项] 按钮，然后【说道】。' && r.fixed.length === 0; })());
// ⑥ 接进 guardText：卡的插图正则（本卡是 disabled、靠 helper 运行时开启）也要能匹配上
const imgExt28 = { regex_scripts: [{ scriptName: '插图', findRegex: '/<NSFW_IMG>/', replaceString: '<img src=x>', disabled: true }] };
const imgProf28 = buildProfile(imgExt28);
check('⑥ 关着的渲染脚本也进 rawTags（所以不会被当未声明块删掉）', (imgProf28.rawTags || []).indexOf('NSFW_IMG') >= 0 && (imgProf28.anchors || []).length === 0, imgProf28.rawTags);
const g28 = guardText('【NSFW_IMG>p.jpg</NSFW_IMG>', imgProf28, { injectAnchor: false });
check('⑥ guardText 顺手修好括号并记账', g28.text === '<NSFW_IMG>p.jpg</NSFW_IMG>' && g28.actions.some((a) => a.type === 'bracket-tag-fixed'), g28);
check('⑥ 关掉开关就不动（fixBracketTags=false）', guardText('【NSFW_IMG>p.jpg</NSFW_IMG>', imgProf28, { injectAnchor: false, fixBracketTags: false }).text === '【NSFW_IMG>p.jpg</NSFW_IMG>');
// ⑦ 面板接线
check('⑦ 面板有开关、统计与日志接线', idxSrc.indexOf('fixBracketTags') > 0 && idxSrc.indexOf("'bracket-tag-fixed'") > 0 && idxSrc.indexOf('cc-bracket-tags') > 0 && idxSrc.indexOf('括号修复') > 0);
check('⑦ 括号修好会强制重渲染该楼（否则图片/面板出不来）', /forceRerender = true/.test(idxSrc) && /if \(rerender \|\| forceRerender\)/.test(idxSrc), 'forceRerender 接线');

console.log('');
console.log('结果: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
