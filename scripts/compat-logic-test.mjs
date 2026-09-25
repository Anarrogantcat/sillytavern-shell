// scripts/compat-logic-test.mjs — card-compat 逻辑层夹具断言（不依赖 ST/Electron）
import { readFileSync } from 'node:fs';
import { repairYamlStructure, renderChangelogMarkdown, detectVariableProtocol, extractSetPaths, coverageByProtocol, scanCardCompatibility, normalizeRegexForTags, tagsOfLoose, detectFrontEndViews, anchoredViewConsuming, regexFromFindRegex, classifyNoRules, repairBracketTags, detectDisabledViews, viewNameCore, longestCommonRun, frontBlockVerdict, pickReminderFields, patchApplyVerdict, stableStringify, parseInitVar, applyVarOps, parseSetCommands, schemaHints, replayFloorStates, planFloorFixes, detectVarScope, pathMatches, stateDiffFields, valueAtPath, negativeFields, fillSchemaDefaults, diagnosisReportText, diagnosisActions, isPlaceholderValue, isPlaceholderAt, emptyFailStreak, noteFailure, FAIL_CATS, moneyFlowHint, moneyAmountOf, moneyPathsIn, moneyLedgerDrift, moneyCorrection , unwrapPathWrapper, extractStatusTable, parseStatusTable, mergeStatusTable, statusTableDiff, coerceToShape, isNonYamlTag } from '../extensions/card-compat/logic.js';
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
const fhR1 = guardText('正文内容。', c1, { injectAnchor: true, anchorStyle: 'self' });
check('缺失时补自闭合锚点', fhR1.text.includes('<StatusPlaceHolderImpl/>') && fhR1.actions.some(a => a.type === 'anchor-injected'), fhR1);
const fhR1b = guardText('正文内容。', c1, { injectAnchor: false });
check('未开兜底时不改文本', fhR1b.text === '正文内容。' && fhR1b.actions.some(a => a.type === 'anchor-missing'));
check('数据块缺失只报警、不伪造', fhR1b.actions.some(a => a.type === 'data-missing') && !/UpdateVariable>\S/.test(fhR1b.text));

console.log('— 夹具 2：<StatusBar> 型卡（未闭合修复）');
const c2 = buildProfile({ regex_scripts: [{ scriptName: '三年的水/状态栏', findRegex: '<StatusBar>([\\s\\S]*?)<\\/StatusBar>', placement: [2], replaceString: '<div>bar</div>' }] });
const fhR2 = guardText('正文。\n<StatusBar>日期: 2025-01-01 没有闭合', c2, { repairClosure: true });
check('未闭合→自动补 </StatusBar>', fhR2.text.trimEnd().endsWith('</StatusBar>') && fhR2.actions.some(a => a.type === 'anchor-close-repaired'), fhR2);

console.log('— 夹具 3：卡自带「隐藏状态栏」脚本时不得注入');
const c3 = buildProfile({ regex_scripts: [
    { scriptName: 'AI隐藏状态栏', findRegex: '<StatusBar>[\\s\\S]*?<\\/StatusBar>', placement: [2], replaceString: '' },
]});
check('只有剥除脚本 → hideTargets 含 StatusBar', c3.hideTargets.includes('StatusBar'), c3);
const fhR3 = guardText('正文。', c3, { injectAnchor: true, anchorStyle: 'pair' });
check('只有剥除脚本时不注入', !fhR3.text.includes('<StatusBar') && !fhR3.actions.some(a => a.type === 'anchor-injected'), fhR3);
const c3b = buildProfile({ regex_scripts: [
    { scriptName: 'AI隐藏状态栏', findRegex: '<StatusBar>[\\s\\S]*?<\\/StatusBar>', placement: [2], replaceString: '' },
    { scriptName: '状态栏', findRegex: '<StatusBar>([\\s\\S]*?)<\\/StatusBar>', placement: [2], replaceString: '<div>bar</div>' },
]});
check('剥除+渲染并存 → 仍视为锚点', c3b.injectableAnchors.includes('StatusBar'), c3b);
const fhR3b = guardText('正文。', c3b, { injectAnchor: true, anchorStyle: 'pair' });
check('并存时应当补锚点', fhR3b.text.includes('<StatusBar>'), fhR3b);

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
check('删掉 2 个未声明块（world_setting / status_block）', s14.removed.length === 2 && ['world_setting', 'status_block'].every((t) => !s14.text.includes(t)), s14.removed);
check('0.23.1：konatan_planning~ 属于预设规划块，改为**保留**', s14.text.includes('<konatan_planning~>') && !s14.removed.some((r) => r.tag === 'konatan_planning~'));
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
// 版本断言不再写死具体数字（每升一次版本夹具就红一次，已踩过）：从 manifest 读当前版本，再校验代码里的 VERSION 与它一致
function manifestVersion() {
    try {
        const raw = readFileSync(new URL('../extensions/card-compat/manifest.json', import.meta.url), 'utf8');
        return JSON.parse(raw).version;
    } catch (_) { return null; }
}
function versionWired() {
    const v = manifestVersion();
    return !!v && idxSrc.indexOf("const VERSION = '" + v + "'") > 0;
}
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
const fhR21 = repairYamlStructure(broken21, ['Status_block']);
check('修出 3 处：两个列表项下沉 + 一处逗号并回', fhR21.fixes.length === 3 && fhR21.fixes.filter((f) => f.kind === 'list-inline-demote').length === 2 && fhR21.fixes.some((f) => f.kind === 'trailing-text-merged'), fhR21.fixes);
check('行内标量下沉为「名字」子键', fhR21.text.includes('    - 用户:') && fhR21.text.includes('        名字: "👤 涂山清璃 "') && !fhR21.text.includes('- 用户: "'), fhR21.text.split(NL).slice(3, 8));
check('逗号后的文字并回引号内', fhR21.text.includes('穿搭: "长裙堆叠。衬衫由于贴合而产生褶皱。"'), fhR21.text);
check('普通字符串列表项不动', fhR21.text.includes('    - "1. 选项一"'));
const fhR21b = repairYamlStructure('<T>' + NL + '  - 用户: "A"' + NL + '      名字: "B"' + NL + '      行动: "C"' + NL + '</T>', ['T']);
check('兄弟键已有名字类键 → 只删冗余标量', fhR21b.text.includes('- 用户:') && !fhR21b.text.includes('- 用户: "A"') && fhR21b.fixes[0].kind === 'list-inline-drop', fhR21b);
const clean21 = '<T>' + NL + '状态栏:' + NL + '  用户列表:' + NL + '    - 用户:' + NL + '        名字: "X"' + NL + '</T>';
check('本来就合法的块一处都不动', repairYamlStructure(clean21, ['T']).fixes.length === 0);
check('块外正文不动', repairYamlStructure('正文 - 用户: "X"' + NL, ['T']).fixes.length === 0);
let jsyaml21 = null;
try { jsyaml21 = (await import('js-yaml')).default; } catch (_) {}
if (jsyaml21) {
  const innefhR21 = (t) => t.replace('<Status_block>', '').replace('</Status_block>', '');
  let before21 = 'ok';
  try { jsyaml21.load(innefhR21(broken21)); } catch (_) { before21 = 'fail'; }
  const p21 = jsyaml21.load(innefhR21(fhR21.text));
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
check('⑦ 面板有开关、统计与日志接线', ['fixBracketTags', "'bracket-tag-fixed'", 'cc-bracket-tags', 'cc-stats', 'cc-chips', 'cc-log', 'cc-table'].every((k) => idxSrc.indexOf(k) > 0));
check('⑦ 括号修好会强制重渲染该楼（否则图片/面板出不来）', /forceRerender = true/.test(idxSrc) && /if \(rerender \|\| forceRerender\)/.test(idxSrc), 'forceRerender 接线');

console.log('— 夹具 29：不许把变量补丁当「未声明块」删掉（0.8.1 修 P0）');
const decl29 = new Set(['UpdateVariable', 'StatusBar']);
const st29 = (txt) => stripUndeclaredBlocks(txt, { declared: decl29, keep: KEEP_BLOCKS });
const nestedPatch = '<UpdateVariable>' + NL + '<JSONPatch>[{"op":"replace","path":"/a","value":1}]</JSONPatch>' + NL + '</UpdateVariable>';
const fhR29a = st29(nestedPatch);
check('① 嵌套的 <JSONPatch> 不会被删（实测 67/74 张卡中招）', fhR29a.text === nestedPatch && fhR29a.removed.length === 0, fhR29a);
const alonePatch = '<JSONPatch>[{"op":"replace","path":"/a","value":1}]</JSONPatch>';
check('② 独立的 <JSONPatch> 也保留（KEEP_BLOCKS）', st29(alonePatch).text === alonePatch);
const innerUnknown = '<UpdateVariable>' + NL + '<DeltaPatch>[1]</DeltaPatch>' + NL + '</UpdateVariable>';
check('③ 声明块里的未知子标签也保留（通用嵌套保护）', st29(innerUnknown).text === innerUnknown && st29(innerUnknown).removed.length === 0);
const echo = '<world_setting>' + NL + '一大段设定原文' + NL + '</world_setting>' + NL + '正文';
const fhR29d = st29(echo);
check('④ 世界书回显仍然被清理（原有功能没被削弱）', fhR29d.removed.length === 1 && fhR29d.removed[0].tag === 'world_setting' && fhR29d.text.indexOf('一大段设定原文') < 0, fhR29d);
check('⑤ 自创标签仍然被清理', st29('<status_block>x</status_block>').removed.length === 1);
const halfOpen = '<weird_unknown_block>半截块';
check('⑥ 未声明但没闭合 → 只报告不删', (function () { const r = st29(halfOpen); return r.text === halfOpen && r.unclosed.join(',') === 'weird_unknown_block'; })());
check('⑦ KEEP_BLOCKS 已含协议内部标签', ['jsonpatch', 'updatevariable'].every((t) => KEEP_BLOCKS.has(t)));
check('⑧ 保护区逻辑在位', /insideProtected/.test(readFileSync(new URL('../extensions/card-compat/logic.js', import.meta.url), 'utf8')));

console.log('— 夹具 30：新卡哨兵（0.9.0）——禁用渲染正则 + 疑似新方言');
const imgScript = { scriptName: '0.[NSFW插图]电脑适配', disabled: true, findRegex: '/<NSFW_IMG>(.*?)<\\/NSFW_IMG>/gi', replaceString: '<center><img src="https://x/$1" style="width:100%"></center>' };
const barScript = { scriptName: '[界面]状态栏', disabled: true, findRegex: '/<StatusPlaceHolderImpl\\s*\\/>/g', replaceString: '<div>' + 'x'.repeat(600) + '</div>' };
const panelScript = { scriptName: '[界面]开局面板', disabled: true, findRegex: '/【开局】/', replaceString: '<!DOCTYPE html><html><body>' + 'x'.repeat(2500) + '<script>1</script></body></html>' };
const onScript = { scriptName: '状态栏', findRegex: '/<StatusPlaceHolderImpl\\/>/', replaceString: '<div>' + 'x'.repeat(600) + '</div>' };
const dv1 = detectDisabledViews({ regex_scripts: [imgScript, barScript, panelScript, onScript] });
check('① 插图正则被认出（本体只有 100 多字节也不漏）', dv1.images.length === 1 && dv1.images[0].name.indexOf('NSFW插图') > 0, dv1.images);
check('② 状态栏 / 面板分别归位', dv1.bars.length === 1 && dv1.panels.length === 1, dv1);
check('③ 启用的脚本不算', dv1.others.length === 0 && dv1.images.length === 1);
check('④ 没有自动开启脚本时不标记 autoEnable', dv1.autoEnable === false && dv1.total === 3, dv1);
const dv2 = detectDisabledViews({ regex_scripts: [imgScript], tavern_helper: { scripts: [{ name: '自动开启角色卡局部正则', content: "import 'https://x/y.js'" }] } });
check('⑤ 卡自带自动开启脚本 → autoEnable=true（不误报）', dv2.autoEnable === true && dv2.total === 1, dv2);
const autoExt = { regex_scripts: [barScript], tavern_helper: { scripts: [{ name: '自动开启角色卡局部正则', content: 'x' }] } };
const sc30 = scanCardCompatibility([
    { name: '关着渲染正则的卡', data: { extensions: { regex_scripts: [barScript] } } },
    { name: '卡自带开启脚本', data: { extensions: autoExt } },
    { name: '疑似新方言', data: { extensions: Object.assign({}, scanDataNoRule.extensions), character_book: { entries: [{ comment: '[mvu_update]变量更新规则', content: 'check: 没有归属字段的条件' }] } } },
]);
check('⑥ 关着又不自动开启 → 预警 disabled-views', (sc30.rows[0].alerts || []).indexOf('disabled-views') >= 0 && sc30.rows[0].disabledViews === 1 && sc30.rows[0].autoEnable === false, sc30.rows[0]);
check('⑦ 卡自带开启脚本 → 不预警，但仍报告条数', (sc30.rows[1].alerts || []).indexOf('disabled-views') < 0 && sc30.rows[1].disabledViews === 1 && sc30.rows[1].autoEnable === true, sc30.rows[1]);
check('⑧ 有 check 却抽不出 → 预警 new-dialect（给我看的信号）', (sc30.rows[2].alerts || []).indexOf('new-dialect') >= 0 && sc30.rows[2].ruleStyle === 'check-unparsed', sc30.rows[2]);
check('⑨ 总览带预警直方图与禁用渲染正则计数', sc30.summary.alerts['disabled-views'] === 1 && sc30.summary.alerts['new-dialect'] === 1 && sc30.summary.disabledViews === 2 && sc30.summary.autoEnableCards === 1, sc30.summary);
check('⑩ 面板接线（预警标签/协议行/每行 ❗/复制报告）', idxSrc.indexOf('alertLabel') > 0 && idxSrc.indexOf('scanAlerts') > 0 && idxSrc.indexOf('disViews') > 0 && idxSrc.indexOf('disabledViews') > 0 && idxSrc.indexOf("' ❗'") > 0 && idxSrc.indexOf("' ◇'") > 0);

console.log('— 夹具 31：哨兵细分「真缺」与「备选」（0.9.1）');
check('① 名字归一化去掉括号与版本/端修饰词', viewNameCore('【选一】数据库默认正则1（移动端适配）').indexOf('数据库默认正则1') >= 0 && viewNameCore('✅状态栏-美化 旧版').indexOf('旧版') < 0, viewNameCore('【选一】数据库默认正则1（移动端适配）'));
check('② 公共子串：两条不同名字也能认出同一块', longestCommonRun(viewNameCore('【选一】数据库默认正则1'), viewNameCore('【选一】数据库多功能美化正则1')) >= 3);
check('② 公共子串：不相关名字不会误判', longestCommonRun(viewNameCore('开场白简化版'), viewNameCore('战斗系统')) < 3);
const enabledImg = { scriptName: '正文美化', findRegex: '/<content>/', replaceString: '<img src=\"https://x/a.png\" style=\"max-width:100%; height:auto; border-radius:12px;\">' };
const coveredBySameKind = detectDisabledViews({ regex_scripts: [
    { scriptName: '正文美化-离线版', disabled: true, findRegex: '/<content>/', replaceString: '<img src=\"https://x/a.png\" style=\"max-width:100%; height:auto; border-radius:12px;\">' },
    enabledImg,
] });
check('③ 同类已有启用项 → 标记 covered 并给出 coveredBy', coveredBySameKind.total === 1 && coveredBySameKind.uncovered === 0 && coveredBySameKind.images[0].coveredBy === '正文美化', coveredBySameKind.images);
const coveredByName = detectDisabledViews({ regex_scripts: [
    { scriptName: '正文美化-离线版', disabled: true, findRegex: '/<content>/', replaceString: '<!DOCTYPE html><html><body>' + 'x'.repeat(2600) + '</body></html>' },
    enabledImg,
] });
check('④ 名字互相包含也算备选（跨种类）', coveredByName.uncovered === 0 && !!coveredByName.panels[0].coveredBy, coveredByName);
const uncoveredOne = detectDisabledViews({ regex_scripts: [
    { scriptName: '单独状态栏', disabled: true, findRegex: '/<StatusPlaceHolderImpl\\/>/', replaceString: '<div>' + 'x'.repeat(600) + '</div>' },
] });
check('⑤ 没有任何同类/相似启用项 → uncovered=1', uncoveredOne.total === 1 && uncoveredOne.uncovered === 1 && !uncoveredOne.bars[0].coveredBy, uncoveredOne.bars);
const sc31 = scanCardCompatibility([
    { name: '真缺渲染正则', data: { extensions: { regex_scripts: [{ scriptName: '单独状态栏', disabled: true, findRegex: '/<StatusPlaceHolderImpl\\/>/', replaceString: '<div>' + 'x'.repeat(600) + '</div>' }] } } },
    { name: '只是备选', data: { extensions: { regex_scripts: [{ scriptName: '正文美化-离线版', disabled: true, findRegex: '/<content>/', replaceString: '<img src=\"https://x/a.png\" style=\"max-width:100%; height:auto; border-radius:12px;\">' }, enabledImg] } } },
]);
check('⑥ 真缺 → 报警 disabled-views；备选 → 只算 disabled-alternative', (sc31.rows[0].alerts || []).indexOf('disabled-views') >= 0 && (sc31.rows[1].alerts || []).indexOf('disabled-alternative') >= 0 && (sc31.rows[1].alerts || []).indexOf('disabled-views') < 0, sc31.rows.map((x) => x.name + ':' + JSON.stringify(x.alerts)));
check('⑦ 行字段带 disabledUncovered', sc31.rows[0].disabledUncovered === 1 && sc31.rows[1].disabledUncovered === 0, sc31.rows.map((x) => x.disabledUncovered));
check('⑧ 总览直方图分开计数', sc31.summary.alerts['disabled-views'] === 1 && sc31.summary.alerts['disabled-alternative'] === 1 && sc31.summary.disabledUncovered === 1 && sc31.summary.disabledViews === 2, sc31.summary);
check('⑨ 面板接线（备选说明/未覆盖计数/预警标签）', idxSrc.indexOf('disAlt') > 0 && idxSrc.indexOf('disabledUncovered') > 0 && idxSrc.indexOf("'alert_disabled-alternative'") > 0);
check('⑨ 行尾标记分开：❗=真缺/新方言，◇=备选', idxSrc.indexOf("' ❗'") > 0 && idxSrc.indexOf("' ◇'") > 0 && /indexOf\('disabled-alternative'\)/.test(idxSrc));

console.log('— 夹具 32：本楼前端块自检（0.9.2）');
check('① 没有前端块 → none', frontBlockVerdict({ front: 0, rendered: 0, collapsed: 0, fences: 0 }).level === 'none');
check('② 全部渲染 → ok', frontBlockVerdict({ front: 2, rendered: 2, collapsed: 0, fences: 0 }).level === 'ok');
check('③ 只有一部分渲染 → partial（实测病灶：刷新后才会全出来）', frontBlockVerdict({ front: 2, rendered: 1, collapsed: 0, fences: 0 }).level === 'partial');
check('④ 一个都没渲染、但有折叠按钮 → collapse（酒馆助手折叠了）', frontBlockVerdict({ front: 2, rendered: 0, collapsed: 2, fences: 0 }).level === 'collapse');
check('⑤ 一个都没渲染、也没折叠 → unrendered（要刷新/切聊天/重生成）', frontBlockVerdict({ front: 2, rendered: 0, collapsed: 0, fences: 0 }).level === 'unrendered');
check('⑥ 数字原样带回，且容错 undefined', (function () { const r = frontBlockVerdict({ front: 1, rendered: 0, collapsed: 0, fences: 3 }); const z = frontBlockVerdict(undefined); return r.fences === 3 && r.level === 'unrendered' && z.level === 'none' && z.front === 0; })());
check('⑦ 自检函数接线（判定原样用酒馆助手的 html>/<head/<body、找 TH-render 与折叠按钮）', idxSrc.indexOf('checkFrontBlocks') > 0 && idxSrc.indexOf("['html>', '<head', '<body']") > 0 && idxSrc.indexOf('div.TH-render') > 0 && idxSrc.indexOf('TH-collapse-code-block-button') > 0);
check('⑧ 面板接线（按钮/结果行/被动自检/一键检查也跑）', idxSrc.indexOf('cc-check-front') > 0 && idxSrc.indexOf('cc-front') > 0 && /CHARACTER_MESSAGE_RENDERED[\s\S]{0,160}checkFrontBlocks/.test(idxSrc) && /verifyRendered\(chat\.length - 1\); checkFrontBlocks\(chat\.length - 1\)/.test(idxSrc));

console.log('— 夹具 33：裸 {A|B} 模板组 + 必更字段轮询（0.9.3；实测「破产后姐姐…」卡）');
check('① 裸 {林婉婷|陈慧兰} 现在能展开（旧实现不认，会把带花括号的伪路径写进提醒）', expandTemplateGroups(['{林婉婷|陈慧兰}.位置']).join(',') === '林婉婷.位置,陈慧兰.位置', expandTemplateGroups(['{林婉婷|陈慧兰}.位置']));
check('① 带 $ 的写法不受影响', expandTemplateGroups(['user.累计支出_$' + '{林婉婷|陈慧兰}']).join(',') === 'user.累计支出_林婉婷,user.累计支出_陈慧兰');
check('① 多组路径逐层展开', expandTemplateGroups(['{A|B}.{x|y}']).join(',') === 'A.x,A.y,B.x,B.y', expandTemplateGroups(['{A|B}.{x|y}']));
const many33 = [];
for (let i = 0; i < 5; i++) many33.push({ path: '系统.F' + i });
for (let i = 0; i < 20; i++) many33.push({ path: '林婉婷.F' + i });
many33.push({ path: '互动次数.林婉婷与user' }, { path: 'user.累计支出_林婉婷' }, { path: '母女关系.母女氛围' });
const pick33 = pickReminderFields(many33, 14);
check('② 轮询后覆盖到所有顶层分组（旧实现只看前 12 条 → 互动次数/usera 永远缺席）', (function () { const g = new Set(pick33.map((f) => f.path.split('.')[0])); return g.has('系统') && g.has('林婉婷') && g.has('互动次数') && g.has('user') && g.has('母女关系'); })(), [...new Set(pick33.map((f) => f.path.split('.')[0]))]);
check('② 条数不超过上限', pick33.length === 14, pick33.length);
check('② 字段少时原样返回（不重排）', pickReminderFields([{ path: 'a.b' }, { path: 'c.d' }], 14).map((f) => f.path).join(',') === 'a.b,c.d');
check('② 空输入安全', pickReminderFields(undefined, 5).length === 0 && pickReminderFields([], 5).length === 0);
check('③ 扩展接线（提醒用 pickReminderFields，0.29.0 起带 mustInclude）', idxSrc.indexOf('pickReminderFields(prof.required || [], 14') > 0);

console.log('— 夹具 34：补丁到底生效了没（0.9.4；实测「破产后姐姐…」第 7 楼）');
check('① 没变量块 → no-block', patchApplyVerdict({ hasBlock: false, ops: 0 }).level === 'no-block');
check('② 有块但没有补丁操作 → no-patch（实测该卡第 3 楼：只有 Analysis）', patchApplyVerdict({ hasBlock: true, hasPatch: false, ops: 0 }).level === 'no-patch');
check('③ 拿不到 stat_data → unknown（不能瞎报）', patchApplyVerdict({ hasBlock: true, hasPatch: true, ops: 12, hasStates: false }).level === 'unknown');
check('④ 补丁合法但两楼 stat_data 一模一样 → not-applied（实测病灶）', patchApplyVerdict({ hasBlock: true, hasPatch: true, ops: 12, hasStates: true, sameState: true }).level === 'not-applied');
check('⑤ stat_data 变了 → applied', patchApplyVerdict({ hasBlock: true, hasPatch: true, ops: 14, hasStates: true, sameState: false }).level === 'applied');
check('⑥ stableStringify 忽略键顺序', stableStringify({ a: 1, b: { x: 2, y: 3 } }) === stableStringify({ b: { y: 3, x: 2 }, a: 1 }));
check('⑥ stableStringify 能区分真实差异', stableStringify({ a: 1 }) !== stableStringify({ a: 2 }) && stableStringify([1, 2]) !== stableStringify([2, 1]));
check('⑥ stableStringify 容错（undefined / 循环安全由 try 兜底）', stableStringify(undefined) === undefined && stableStringify(null) === 'null');
check('⑦ 扩展接线（检测器/取变量/面板行/提示语/生成结束钩子）', idxSrc.indexOf('function checkPatchApplied') > 0 && idxSrc.indexOf('function mvuVarsOf') > 0 && idxSrc.indexOf('cc-apply') > 0 && idxSrc.indexOf("'apply_not-applied'") > 0 && /GENERATION_ENDED[\s\S]{0,400}checkPatchApplied/.test(idxSrc));

console.log('— 夹具 35：变量兜底引擎（0.10.0，不依赖 MVU）');
const ivText35 = ['系统:', '  日期: 2025年7月18日', '  时间: 14:00', '  剧情天数: 1', '林婉婷:', '  位置: user家门口', '  经济:', '    欠款: 3000', '    现金: 500', '  身体状态:', '    嘴巴:', '      状态: 干净', '      总次数: 0', 'user:{x}', '  累计支出_林婉婷: 0', '标签: [a, b]', '说明: |', '  第一行', '  第二行'].join(NL).replace('{x}', '');
const iv35 = parseInitVar(ivText35);
check('① InitVar 解析：嵌套映射 + 数字 + 中文键', iv35['系统']['剧情天数'] === 1 && iv35['林婉婷']['经济']['欠款'] === 3000 && iv35['林婉婷']['身体状态']['嘴巴']['状态'] === '干净', iv35['系统']);
check('① InitVar 解析：块标量 | 收集后续缩进行', iv35['说明'] === '第一行' + NL + '第二行', iv35['说明']);
const ivList35 = parseInitVar(['角色:', '  技能:', '    - 剑术', '    - 炼丹'].join(NL));
check('① InitVar 解析：- 列表变数组', Array.isArray(ivList35['角色']['技能']) && ivList35['角色']['技能'].join(',') === '剑术,炼丹', ivList35['角色'].技能);
const base35 = { 系统: { 时间: '14:00', 剧情天数: 1 }, 角色: { 钱: 100, 体力: 50 }, 日志: ['a'] };
const rv1 = applyVarOps(base35, [{ op: 'replace', path: '/系统/时间', value: '14:25' }, { op: 'delta', path: '/角色/钱', value: -50 }, { op: 'delta', path: '/角色/体力', value: 10 }]);
check('② replace / delta 生效', rv1.state['系统']['时间'] === '14:25' && rv1.state['角色']['钱'] === 50 && rv1.state['角色']['体力'] === 60 && rv1.applied.length === 3, rv1.state);
check('② 不改原对象（纯函数）', base35['系统']['时间'] === '14:00' && base35['角色']['钱'] === 100);
check('② 路径 /a/b 与 a.b 等价', stableStringify(applyVarOps(base35, [{ op: 'replace', path: '系统.时间', value: 'X' }]).state) === stableStringify(applyVarOps(base35, [{ op: 'replace', path: '/系统/时间', value: 'X' }]).state));
const rv2 = applyVarOps(base35, [{ op: 'replace', path: '/不存在/字段', value: 1 }, { op: 'delta', path: '/系统/时间', value: 5 }]);
check('③ 父路径不存在 / delta 非数字 → 跳过并记账', rv2.applied.length === 0 && rv2.skipped.length === 2, rv2.skipped);
const rv3 = applyVarOps(base35, [{ op: 'insert', path: '/角色/耐力', value: 10 }, { op: 'insert', path: '/日志/-', value: 'b' }, { op: 'remove', path: '/角色/体力' }]);
check('④ insert 新增键 / 数组用 - 追加 / remove 删除', rv3.state['角色']['耐力'] === 10 && rv3.state['日志'].join(',') === 'a,b' && rv3.state['角色']['体力'] === undefined, rv3.state);
const rv4 = applyVarOps({ a: { b: 1 } }, [{ op: 'move', from: '/a/b', path: '/a/c' }]);
check('④ move 搬移', rv4.state['a']['c'] === 1 && rv4.state['a']['b'] === undefined, rv4.state);
const scc = parseSetCommands(['_.set("角色.金钱", 100)', '_.add(角色.体力, -10)', '_.assign(角色, 姓名, "小明")', '_.remove(角色.临时)'].join(NL));
check('⑤ 命令式 _.set/_.add/_.assign/_.remove 解析', scc.length === 4 && scc[0].op === 'replace' && scc[0].value === 100 && scc[1].op === 'delta' && scc[1].value === -10 && scc[2].path === '角色.姓名' && scc[3].op === 'remove', scc);
check('⑥ 扩展接线（引擎/按钮条/自动兜底/开关/事件重注入）', idxSrc.indexOf('function applyFloorVars') > 0 && idxSrc.indexOf('function ensureVarBar') > 0 && idxSrc.indexOf('cc-var-bar') > 0 && idxSrc.indexOf('function mvuActive') > 0 && idxSrc.indexOf('varAuto') > 0 && idxSrc.indexOf('varBar') > 0 && /GENERATION_ENDED[\s\S]{0,600}recomputeAllFloors/.test(idxSrc) && /MutationObserver[\s\S]{0,300}cc-var-bar/.test(idxSrc));
check('⑥ 样式里有按钮条', readFileSync(new URL('../extensions/card-compat/style.css', import.meta.url), 'utf8').indexOf('#cc-var-bar') > 0);

console.log('— 夹具 36：幂等重算引擎（0.11.0；正面解决旧 A 路的三个风险）');
// ① schemaHints：从真实 MVU Zod 写法里抠 _.clamp 与类型（风险 2）
const schema36 = [
  'export const Schema = z.object({',
  '    系统: z.object({',
  '        剧情天数: z.coerce.number(),',
  '        时间: z.string(),',
  '    }),',
  '    林婉婷: z.object({',
  '        好感度: z.coerce.number().transform(v => _.clamp(v, 0, 100)),',
  '        堕落度: z.coerce.number().transform(v => _.clamp(v, 0, 100)),',
  '        经济: z.object({',
  '            欠款: z.coerce.number().transform(v => _.clamp(v, 0, 999999)),',
  '        }),',
  '    }),',
  '    标记: z.coerce.boolean(),',
  '});',
].join(NL);
const h36 = schemaHints(schema36);
const clamp36 = h36.clamps.map((c) => c.path.join('.') + ':' + c.min + ',' + c.max);
check('① 抠出嵌套路径的 _.clamp（含三层 林婉婷.经济.欠款）', clamp36.indexOf('林婉婷.好感度:0,100') >= 0 && clamp36.indexOf('林婉婷.堕落度:0,100') >= 0 && clamp36.indexOf('林婉婷.经济.欠款:0,999999') >= 0, clamp36);
check('① 只手收带 _.clamp 的字段（不伪造范围）', h36.clamps.length === 3, h36.clamps.length);
check('① 类型表：number / string / boolean', (function () { const m = {}; for (const t of h36.types) m[t.path.join('.')] = t.type; return m['系统.剧情天数'] === 'number' && m['系统.时间'] === 'string' && m['标记'] === 'boolean'; })(), h36.types);
// ② 夹取 + 类型转换（风险 2）
const c36 = applyVarOps({ 林婉婷: { 好感度: 90, 经济: { 欠款: 100 } }, 系统: { 剧情天数: 1 } }, [{ op: 'delta', path: '/林婉婷/好感度', value: 30 }, { op: 'delta', path: '/系统/剧情天数', value: '2' }], { clamps: h36.clamps });
check('② delta 超上限被夹到 100（对齐 MVU 的 _.clamp）', c36.state['林婉婷']['好感度'] === 100, c36.state);
check('② 字符串数字 delta 按现有类型转成数字（对齐 z.coerce）', c36.state['系统']['剧情天数'] === 3, c36.state);
const c36b = applyVarOps({ 标记: true }, [{ op: 'replace', path: '/标记', value: 'false' }]);
check('② 布尔字符串按现有类型转布尔', c36b.state['标记'] === false, c36b.state);
check('② coerce:false 时保持原样（可关）', applyVarOps({ 系统: { 剧情天数: 1 } }, [{ op: 'delta', path: '/系统/剧情天数', value: '2' }], { coerce: false }).state['系统']['剧情天数'] === 1);
// ③ pathMatches
check('③ pathMatches：精确 / * 通配一层 / 长度不等不匹配', pathMatches(['林婉婷', '好感度'], ['林婉婷', '好感度']) === true && pathMatches(['林婉婷', '好感度'], ['*', '好感度']) === true && pathMatches(['林婉婷', '好感度'], ['林婉婷']) === false);
// ④ replayFloorStates：幂等（风险 1 —— 旧 A 路反复累加 delta）
const floorOps36 = [
  [],
  [{ op: 'delta', path: '/角色/钱', value: -20 }],
  [{ op: 'replace', path: '/角色/体力', value: 40 }],
  [{ op: 'delta', path: '/角色/钱', value: 5 }, { op: 'replace', path: '/系统/时间', value: '15:00' }],
];
const init36 = { 角色: { 钱: 100, 体力: 50 }, 系统: { 时间: '14:00' } };
const rep36a = replayFloorStates(init36, floorOps36);
const rep36b = replayFloorStates(init36, floorOps36);
check('④ 每层给出补丁后的状态（第 2 层 delta 只算一次）', rep36a[1].state['角色']['钱'] === 80 && rep36a[3].state['角色']['钱'] === 85, rep36a.map((x) => x.state['角色']['钱']));
check('④ 幂等：重放两次结果完全一致（旧 A 路会得到 80 → 75 → 70）', stableStringify(rep36a) === stableStringify(rep36b));
check('④ 没有补丁的楼层继承上一层状态', stableStringify(rep36a[0].state) === stableStringify(init36));
check('④ 不改初值对象（纯函数）', init36['角色']['钱'] === 100);
check('④ 汇总每层 applied / skipped', rep36a[3].applied === 2 && rep36a[1].skipped.length === 0);
// ⑤ detectVarScope（风险 3）
check('⑤ all_variables / message 类型 → message（MVU 同款，默认）', detectVarScope('const v = getVariables({ type: "message" }); {{getvar::stat_data}}').scope === 'message');
check('⑤ character 变量 → character', detectVarScope("getVariables({ type: 'character' })").scope === 'character');
check('⑤ chat_metadata / getvar 宏 → chat', detectVarScope('chat_metadata.stat_data').scope === 'chat' && detectVarScope('{{getvar::foo}}').scope === 'chat');
check('⑤ 说不准时默认 message（与 MVU 写在同一处，最安全）', detectVarScope('面板渲染代码').scope === 'message');
// ⑥ 扩展接线
check('⑥ 扩展接线（幂等重算 + 自动修 + 作用域 + 夹取 + 面板开关 + 按钮/生成结束钩子都改走重算）', idxSrc.indexOf('function recomputeAllFloors') > 0 && idxSrc.indexOf('function scheduleVarRepair') > 0 && idxSrc.indexOf('schemaHintsOfCard') > 0 && idxSrc.indexOf('function varScope') > 0 && idxSrc.indexOf('cc-var-repair') > 0 && idxSrc.indexOf('varRepair') > 0 && /checkPatchApplied[\s\S]{0,3000}scheduleVarRepair/.test(idxSrc) && /GENERATION_ENDED[\s\S]{0,600}recomputeAllFloors/.test(idxSrc) && idxSrc.indexOf('await recomputeAllFloors({})') > 0);
check('⑥ 试算模式 dryRun：只统计不写（E2E / 排查用）', idxSrc.indexOf('o.dryRun') > 0 && /dryRun: !!o.dryRun/.test(idxSrc));
check('⑥ 版本号已到 0.12.0', versionWired());

console.log('— 夹具 37：状态级核对（0.11.0；用户实测「一排 ✅ 但状态栏不动，检查不出来」）');
const prev37 = { 系统: { 时间: '14:00', 日期: '2025年7月18日' }, 林婉婷: { 外貌: { 表情: '平静' }, 位置: 'user家门口' }, 陈慧兰: { 位置: '公司' } };
const cufhR37 = { 系统: { 时间: '14:15', 日期: '2025年7月18日' }, 林婉婷: { 外貌: { 表情: '平静' }, 位置: '客厅' }, 陈慧兰: { 位置: '公司' } };
const req37 = [{ path: '系统.时间' }, { path: '系统.日期' }, { path: '林婉婷.外貌.表情' }, { path: '林婉婷.位置' }, { path: '陈慧兰.位置' }];
const sd37 = stateDiffFields(cufhR37, prev37, req37, ['系统.时间', '系统.日期', '林婉婷.外貌.表情', '林婉婷.位置']);
check('① 存储值真的变了 → advanced（系统.时间 / 林婉婷.位置）', sd37.advanced.indexOf('系统.时间') >= 0 && sd37.advanced.indexOf('林婉婷.位置') >= 0, sd37.advanced);
check('② 文本写了但存储值没变 → stuck（病灶：系统.日期 / 林婉婷.外貌.表情）', sd37.stuck.indexOf('系统.日期') >= 0 && sd37.stuck.indexOf('林婉婷.外貌.表情') >= 0, sd37.stuck);
check('③ 文本没写也算不出变化 → absent（陈慧兰.位置：母亲本轮没登场，不该误报）', sd37.absent.indexOf('陈慧兰.位置') >= 0, sd37.absent);
check('④ 三类互斥且不丢字段', (function () { const all = [].concat(sd37.advanced, sd37.stuck, sd37.absent); return all.length === req37.length && new Set(all).size === req37.length; })(), [sd37.advanced.length, sd37.stuck.length, sd37.absent.length]);
check('⑤ 拿不到 stat_data → noBase（不能瞎报 ✅ / ❌）', stateDiffFields(null, prev37, req37, []).noBase === true);
check('⑤b 本楼整体已推进时，「写了但值本来就一样」记 same（不是 ⚠️ 病灶）', (function () { const s = stateDiffFields(cufhR37, prev37, req37, ['系统.时间', '系统.日期', '林婉婷.外貌.表情', '林婉婷.位置'], { applied: true }); return s.same.indexOf('系统.日期') >= 0 && s.same.indexOf('林婉婷.外貌.表情') >= 0 && s.stuck.length === 0 && s.advanced.indexOf('系统.时间') >= 0; })(), 'same');
check('⑥ 模板组路径逐候选比较（{林婉婷|陈慧兰}.外貌.表情 都没变 → stuck）', (function () { const p = { 林婉婷: { 外貌: { 表情: '平静' } }, 陈慧兰: { 外貌: { 表情: '微笑' } } }; const c = { 林婉婷: { 外貌: { 表情: '平静' } }, 陈慧兰: { 外貌: { 表情: '微笑' } } }; const s = stateDiffFields(c, p, [{ path: '{林婉婷|陈慧兰}.外貌.表情' }], ['{林婉婷|陈慧兰}.外貌.表情']); return s.stuck.length === 1 && s.advanced.length === 0; })(), 'template group');
check('⑦ valueAtPath 支持点分与斜杠路径，取不到返回 undefined', valueAtPath({ a: { b: 1 } }, 'a.b') === 1 && valueAtPath({ a: { b: 1 } }, '/a/b') === 1 && valueAtPath({ a: { b: 1 } }, 'a.c') === undefined && valueAtPath(null, 'a') === undefined);
check('⑧ 扩展接线（面板第三列 + 状态行 + 自检里真的算 + 修复提示语）', idxSrc.indexOf('stateDiffFields') > 0 && idxSrc.indexOf("T('colState')") > 0 && idxSrc.indexOf("T('stateSummary')") > 0 && idxSrc.indexOf("T('stateStuckWarn')") > 0 && /checkPatchApplied[\s\S]{0,3000}stateDiffFields/.test(idxSrc));
check('⑨ 切聊天后自动核对（面板第三列自己填上，没生效就自动修）', /CHAT_CHANGED[\s\S]{0,900}checkPatchApplied/.test(idxSrc) && /CHAT_CHANGED[\s\S]{0,900}normalizeRecent/.test(idxSrc));
check('⑩ 按钮不再用不存在的 showConfirm（0.10.0 的病灶：点了没反应），改用 ST 的 callGenericPopup + 异常可见', idxSrc.indexOf('showConfirm(') < 0 && idxSrc.indexOf('POPUP_TYPE.CONFIRM') > 0 && idxSrc.indexOf("T('varBusy')") > 0 && /var-btn-failed/.test(idxSrc) && /recomputeAllFloors\(\{ dryRun: true, silent: true, toast: false \}\)/.test(idxSrc));
check('⑩ same 分类接线（第三列 + 汇总）', idxSrc.indexOf("T('stateSame')") > 0 && idxSrc.indexOf('stateSame') > 0 && /st\.same/.test(idxSrc));

console.log('— 夹具 38：只修「卡住」的楼层（0.11.0；实测「破产后姐姐…」第 3/5/7 楼的真实数据）');
// 真实数据：InitVar 时间 14:00 / 地点 user家门口；第 3 楼只有 <Analysis> 没有 <JSONPatch>，
// 但 MVU 自己的「时间流逝」把 系统.时间 推到 14:15；第 5、7 楼的 <JSONPatch> 合法（时间 14:25、地点 user家客厅）
// 却没被 MVU 应用 —— 状态栏因此一直停在 14:15/user家门口（用户反馈「时间和地点根本就没更新」）。
// 关键：不能拿 [InitVar] 全量重放写回，否则会把 MVU 算出来的 14:15 回退成 14:00。
const init38 = { 系统: { 日期: '2025年7月18日', 时间: '14:00', 地点: 'user家门口' }, 林婉婷: { 位置: 'user家门口', 外貌: { 表情: '平静' }, 心情: '平静', 经济: { 现金: 3000 } }, user: { 累计支出_林婉婷: 0 } };
const s38 = JSON.parse(JSON.stringify(init38));
s38['系统']['时间'] = '14:15';    // MVU 时间流逝的结果（没有任何补丁记录它）
const p5 = [
  { op: 'replace', path: '/系统/时间', value: '14:25' },
  { op: 'replace', path: '/系统/地点', value: 'user家客厅' },
  { op: 'replace', path: '/林婉婷/位置', value: 'user家客厅' },
  { op: 'replace', path: '/林婉婷/心情', value: '满足' },
  { op: 'replace', path: '/林婉婷/外貌/表情', value: '满足的笑意' },
  { op: 'delta', path: '/林婉婷/经济/现金', value: -2500 },
  { op: 'delta', path: '/user/累计支出_林婉婷', value: 2500 },
];
const p7 = [
  { op: 'replace', path: '/系统/时间', value: '14:25' },
  { op: 'replace', path: '/系统/地点', value: 'user家客厅' },
  { op: 'replace', path: '/林婉婷/位置', value: 'user家客厅' },
  { op: 'replace', path: '/林婉婷/心情', value: '深陷肉欲' },
  { op: 'delta', path: '/user/累计支出_林婉婷', value: 100 },
];
// 实测 ST 连 user 楼层也带变量快照（还是旧值）—— 它不许把「已经修好的基线」盖回去
const stored38 = [null, init38, init38, s38, s38, s38, s38, s38, null];
const ops38 = [[], [], [], [], [], p5, [], p7, []];
const plan38 = planFloorFixes(stored38, ops38, init38);
const wrote38 = plan38.filter((p) => p.write).map((p) => p.index);
check('① 只修第 5、7 楼（补丁没生效的）；第 3 楼没有补丁、第 1/2 楼没有可修的 → 不动', wrote38.join(',') === '5,7', wrote38);
check('② 以 MVU 真实值当基线：14:15 的时间流逝被保住（不会被回退成 InitVar 的 14:00）', plan38[5].want['系统']['时间'] === '14:25' && plan38[7].want['系统']['时间'] === '14:25', plan38[7].want['系统']);
check('③ delta 只加一次：现金 3000 → 500（不是 -2000），第 5 楼累计支出 0 → 2500', plan38[5].want['林婉婷']['经济']['现金'] === 500 && plan38[7].want['林婉婷']['经济']['现金'] === 500 && plan38[5].want['user']['累计支出_林婉婷'] === 2500, [plan38[5].want['林婉婷']['经济'], plan38[5].want['user']]);
check('④ user 楼层的旧快照不许盖回基线：第 7 楼 = 第 5 楼修完的值再叠加自己的补丁（累计 2500+100=2600，不是 0+100=100）', plan38[7].want['user']['累计支出_林婉婷'] === 2600 && plan38[7].want['林婉婷']['心情'] === '深陷肉欲' && plan38[7].want['林婉婷']['外貌']['表情'] === '满足的笑意', [plan38[7].want['user'], plan38[7].want['林婉婷']]);
check('⑤ MVU 已应用的楼层（存值变了）标 mvu-applied 且绝不覆盖', (function () { const st = stored38.slice(); st[8] = JSON.parse(JSON.stringify(plan38[7].want)); st[8]['系统']['时间'] = '14:30'; const o8 = ops38.slice(); o8[8] = p7; const pl = planFloorFixes(st, o8, init38); return pl[8].write === false && pl[8].reason === 'mvu-applied'; })(), 'mvu-applied');
check('⑥ 幂等：把修好的值当存值再跑一遍 → 一个都不写', (function () { const st = stored38.slice(); for (const p of plan38) if (p.write) st[p.index] = p.want; const pl2 = planFloorFixes(st, ops38, init38); return pl2.filter((p) => p.write).length === 0; })());
check('⑦ MVU 完全不在场（全无存值）→ 退回 [InitVar] 累积，delta 仍只加一次', (function () { const none = [null, null, null, null, null, null, null, null, null]; const pl = planFloorFixes(none, ops38, init38); const w = pl.filter((p) => p.write); return w.length === 2 && w[0].want['林婉婷']['经济']['现金'] === 500 && w[1].want['林婉婷']['经济']['现金'] === 500; })());
check('⑧ 没有补丁的楼层记 no-ops、不写', plan38[3].ops === 0 && plan38[3].write === false && plan38[3].reason === 'no-ops');
check('⑨ 扩展接线（引擎用 planFloorFixes / 只写 write 的楼层 / 按钮标题已改口径）', idxSrc.indexOf('planFloorFixes') > 0 && /planFloorFixes\(stored, floorOps/.test(idxSrc) && idxSrc.indexOf('if (!p.write) continue') > 0 && idxSrc.indexOf("varReplayTitle") > 0);

console.log('— 夹具 39：收支保护 / 金额负数修复（0.12.0；实测「现金 500 被扣 2500 → -2000」）');
const iv39 = { 系统: { 时间: '14:15' }, 林婉婷: { 经济: { 现金: 500 } }, user: { 累计支出_林婉婷: 2500 } };
const p39 = [
  { op: 'replace', path: '/系统/时间', value: '14:25' },
  { op: 'delta', path: '/林婉婷/经济/现金', value: -2500 },
  { op: 'delta', path: '/user/累计支出_林婉婷', value: 2500 },
];
const fhR39old = applyVarOps(iv39, p39, { overdraftMode: 'floor' });
check('①(旧模式 floor) 会透支的 delta → 整楼 delta 全跳过，replace 照常生效', !!fhR39old.guardHit && fhR39old.guardHit.indexOf('林婉婷.经济.现金') >= 0 && fhR39old.state['林婉婷']['经济']['现金'] === 500 && fhR39old.state['user']['累计支出_林婉婷'] === 2500 && fhR39old.state['系统']['时间'] === '14:25');
check('①(旧模式 floor) 拦下的路径记账（不静默）', fhR39old.skipped.some((x) => x.reason.indexOf('整楼 delta 已跳过') >= 0), fhR39old.skipped);
const fhR39 = applyVarOps(iv39, p39);
check('①(0.27.0 默认 op) 只跳过会透支的那条：现金 500 不动、累计支出照常落地', !!fhR39.guardHit && fhR39.guardHit.indexOf('林婉婷.经济.现金') >= 0 && fhR39.state['林婉婷']['经济']['现金'] === 500 && fhR39.state['user']['累计支出_林婉婷'] === 5000 && fhR39.state['系统']['时间'] === '14:25', fhR39.state);
check('①(0.27.0 默认 op) 跳过原因写明「只跳过它自己」', fhR39.skipped.some((x) => x.reason.indexOf('只跳过它自己') >= 0), fhR39.skipped);

check('① 可关闭：overdraftGuard:false 照旧扣成负数', applyVarOps(iv39, p39, { overdraftGuard: false }).state['林婉婷']['经济']['现金'] === -2000);
check('① 本来就为负的字段不误伤', (function () { const rr = applyVarOps({ 债务: -100 }, [{ op: 'delta', path: '/债务', value: -50 }]); return !rr.guardHit && rr.state['债务'] === -150; })());
check('① 正常的扣款不触发（100 - 50 = 50）', (function () { const rr = applyVarOps({ 现金: 100 }, [{ op: 'delta', path: '/现金', value: -50 }]); return !rr.guardHit && rr.state['现金'] === 50; })());
check('① negativeFields 只挑「初值非负、现值负数」的字段', negativeFields({ a: { b: -1, c: -2 }, d: 3 }, { a: { b: 0 }, d: 0 }).join(',') === 'a.b');
const bad39 = { 系统: { 时间: '14:25' }, 林婉婷: { 经济: { 现金: -2000 } }, user: { 累计支出_林婉婷: 5000 } };
const good39 = { 系统: { 时间: '14:15' }, 林婉婷: { 经济: { 现金: 500 } }, user: { 累计支出_林婉婷: 2500 } };
const plan39 = planFloorFixes([good39, bad39], [[], p39], iv39);
check('② 坏楼层标 negative-fix 并重算：现金回 500、累计按 0.27.0 口径为 5000（+2500 该落地）、时间 14:25', plan39[1].write === true && plan39[1].reason === 'negative-fix' && plan39[1].want['林婉婷']['经济']['现金'] === 500 && plan39[1].want['user']['累计支出_林婉婷'] === 5000 && plan39[1].want['系统']['时间'] === '14:25', plan39[1]);
check('② 好楼层不动', plan39[0].write === false, plan39[0].reason);
check('② 幂等：把修好的值当存值再跑 → 0 写入', planFloorFixes([good39, plan39[1].want], [[], p39], iv39).filter((p) => p.write).length === 0);
check('② 路径全落空会计账（执行层据此宁可不写）', (function () { const pl = planFloorFixes([good39, bad39], [[], [{ op: 'replace', path: '/不存在/字段', value: 1 }]], iv39)[1]; return pl.ops === 1 && pl.skipped.length >= pl.ops; })());
check('② 不带补丁的 user 快照若带坏值也会被覆盖回最新真相', (function () { const pl = planFloorFixes([good39, bad39, bad39], [[], p39, []], iv39); return pl[2].write === true && pl[2].reason === 'negative-fix'; })());
check('③ 扩展接线（引擎传 overdraftGuard / 面板开关 / 拦下与修复都写日志提示）', /overdraftGuard: guardOn/.test(idxSrc) && idxSrc.indexOf("cb('cc-overdraft', 'overdraftGuard')") > 0 && idxSrc.indexOf("T('varGuardHit')") > 0 && idxSrc.indexOf("T('varNegFixed')") > 0 && /var-guard/.test(idxSrc) && /var-negative/.test(idxSrc));
check('③ 版本号已到 0.12.0', versionWired());

console.log('— 夹具 40：Zod 结构静态解析 v2（0.13.0；实测「破产后姐姐…」的真实 schema）');
const REAL_SCHEMA = [
    "import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';",
    "",
    "const 身体部位状态 = z.object({",
    "  状态: z.string().prefault('干净'),",
    "  总次数: z.coerce.number().prefault(0),",
    "  当次次数: z.coerce.number().prefault(0),",
    "}).prefault({});",
    "",
    "const 外貌结构 = z.object({",
    "  发型: z.string().prefault('未描述'),",
    "  妆容: z.string().prefault('未描述'),",
    "  表情: z.string().prefault('未描述'),",
    "}).prefault({});",
    "",
    "const 角色身体状态 = z.record(",
    "  z.enum(['嘴巴', '手', '玉足', '胸部', '小穴', '后庭']),",
    "  身体部位状态,",
    ").prefault({",
    "  嘴巴: {}, 手: {}, 玉足: {}, 胸部: {}, 小穴: {}, 后庭: {},",
    "});",
    "",
    "export const Schema = z.object({",
    "  系统: z.object({",
    "    日期: z.string().prefault('待初始化'),",
    "    时间: z.string().prefault('待初始化'),",
    "    地点: z.string().prefault('待初始化'),",
    "    天气: z.string().prefault('待初始化'),",
    "    剧情天数: z.coerce.number().prefault(0),",
    "  }).prefault({}),",
    "",
    "  林婉婷: z.object({",
    "    位置: z.string().prefault('未知'),",
    "    外貌: 外貌结构,",
    "    穿搭: z.string().prefault('未描述'),",
    "    心情: z.string().prefault('平静'),",
    "    当前在做什么: z.string().prefault('无'),",
    "    经济: z.object({",
    "      欠款: z.coerce.number().prefault(0),",
    "      现金: z.coerce.number().prefault(0),",
    "    }).prefault({}),",
    "    生理: z.object({",
    "      月经状态: z.string().prefault('正常期'),",
    "    }).prefault({}),",
    "    关系态度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),",
    "    堕落进度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),",
    "    身体状态: 角色身体状态,",
    "  }).prefault({}),",
    "",
    "  陈慧兰: z.object({",
    "    位置: z.string().prefault('未登场'),",
    "    外貌: 外貌结构,",
    "    穿搭: z.string().prefault('未描述'),",
    "    心情: z.string().prefault('平静'),",
    "    当前在做什么: z.string().prefault('无'),",
    "    经济: z.object({",
    "      现金: z.coerce.number().prefault(0),",
    "    }).prefault({}),",
    "    生理: z.object({",
    "      月经状态: z.string().prefault('围绝经期'),",
    "    }).prefault({}),",
    "    关系态度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),",
    "    堕落进度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),",
    "    身体状态: 角色身体状态,",
    "  }).prefault({}),",
    "",
    "  母女关系: z.object({",
    "    母女氛围: z.string().prefault('未触发'),",
    "  }).prefault({}),",
    "",
    "  互动次数: z.record(",
    "    z.enum([",
    "      '林婉婷与user',",
    "      '陈慧兰与user',",
    "      '母女与user三人',",
    "      '林婉婷与多人',",
    "      '陈慧兰与多人',",
    "      '母女与多人',",
    "    ]),",
    "    z.coerce.number().prefault(0),",
    "  ).prefault({",
    "    林婉婷与user: 0,",
    "    陈慧兰与user: 0,",
    "    母女与user三人: 0,",
    "    林婉婷与多人: 0,",
    "    陈慧兰与多人: 0,",
    "    母女与多人: 0,",
    "  }),",
    "",
    "  user: z.object({",
    "    累计支出_林婉婷: z.coerce.number().prefault(0),",
    "    累计支出_陈慧兰: z.coerce.number().prefault(0),",
    "  }).prefault({}),",
    "});",
    "",
    "$(() => {",
    "  registerMvuSchema(Schema);",
    "});",
    "",
].join(NL);
const h40 = schemaHints(REAL_SCHEMA);
const p40 = (a) => (a || []).map((x) => x.path.join('.')).sort().join(',');
check('① 4 处 _.clamp 全部拿到完整父路径（旧版丢父路径 → 夹取永不命中）', p40(h40.clamps) === '林婉婷.关系态度,林婉婷.堕落进度,陈慧兰.关系态度,陈慧兰.堕落进度', p40(h40.clamps));
check('② helper 引用（const X = z.object）按引用处展开', h40.types.some((t) => t.path.join('.') === '林婉婷.外貌.发型') && h40.types.some((t) => t.path.join('.') === '陈慧兰.外貌.表情'), h40.types.length);
check('③ z.record(z.enum([...]), helper) 展开成 6 个键 × 3 个字段', h40.types.filter((t) => t.path[1] === '身体状态').length === 36, h40.types.filter((t) => t.path[1] === '身体状态').length);
check('④ 互动次数 record 展开成 6 个 coerce.number 键', h40.types.filter((t) => t.path[0] === '互动次数').length === 6 && h40.types.filter((t) => t.path[0] === '互动次数').every((t) => t.type === 'number' && t.coerce));
check('⑤ z.coerce.number() 标 coerce，z.string() 不标', h40.types.find((t) => t.path.join('.') === '系统.剧情天数').coerce === true && h40.types.find((t) => t.path.join('.') === '系统.时间').coerce === false);
check('⑥ prefault 默认值全部解析（中文键 / 对象 / 尾随逗号）', h40.defaults.find((d) => d.path.join('.') === '林婉婷.心情').value === '平静' && h40.defaults.find((d) => d.path.join('.') === '系统.剧情天数').value === 0 && h40.defaults.filter((d) => d.path[1] === '身体状态').length === 36, h40.defaults.length);
check('⑦ 对象路径清单（用于「只建对象」）', h40.objects.some((p) => p.join('.') === '林婉婷.经济') && h40.objects.some((p) => p.join('.') === '林婉婷.身体状态.嘴巴'), h40.objects.map((p) => p.join('.')));
check('⑧ 这张卡没有无法离线校验的构造', h40.unverifiable.length === 0, h40.unverifiable);
check('⑨ helper 定义被识别（含中文名）', h40.helpers['身体部位状态'] === 'object:3' && h40.helpers['角色身体状态'] === 'record' && h40.helpers['Schema'] === 'object:6', h40.helpers);
const S40 = [
    "const 内 = z.object({ x: z.coerce.number().min(0).max(10) });",
    "export const Schema = z.object({",
    "  '带引号键': z.string().default('d'),",
    "  a: z.enum(['x', 'y']),",
    "  b: z.union([z.literal(1), z.literal(2)]),",
    "  c: z.string().optional().nullable(),",
    "  d: 内,",
    "  e: z.record(z.string(), z.coerce.number()),",
    "  f: z.number().refine((v) => v > 0),",
    "  g: z.string().transform((v) => v.trim()),",
    "  f2: z.number().superRefine(() => {}),",
    "});",
].join(NL);
const h40b = schemaHints(S40);
check('⑩ 单引号键 / default / optional+nullable 都认', h40b.defaults.some((d) => d.path.join('.') === '带引号键') && h40b.optional.map((p) => p.join('.')).indexOf('c') >= 0);
check('⑩ enum 与全字面量 union 都当枚举', h40b.enums.find((e) => e.path.join('.') === 'a').values.join(',') === 'x,y' && h40b.enums.find((e) => e.path.join('.') === 'b').values.join(',') === '1,2');
check('⑩ z.record(z.string(), ...) 用通配 * 展开', h40b.types.some((t) => t.path.join('.') === 'e.*' && t.type === 'number' && t.coerce));
check('⑩ .min/.max 记进 bounds（不混进 clamps）', h40b.bounds.find((b) => b.path.join('.') === 'd.x').min === 0 && h40b.bounds.find((b) => b.path.join('.') === 'd.x').max === 10 && h40b.clamps.length === 0);
check('⑩ refine / superRefine / transform / 动态构造全进 unverifiable（不装作能校验）', (function () { const k = h40b.unverifiable.map((u) => u.kind); return k.indexOf('refine') >= 0 && k.indexOf('transform') >= 0; })(), h40b.unverifiable);
const S40b = ['export const Schema = z.object({', "  'k': z.string(),", '  ...z的展开,', "  [dyn]: z.string(),", '})'].join(NL);
const h40c = schemaHints(S40b);
check('⑩ spread / 计算键 也不漏报', h40c.unverifiable.map((u) => u.kind).indexOf('spread') >= 0 && h40c.unverifiable.map((u) => u.kind).indexOf('computed-key') >= 0, h40c.unverifiable);
check('⑩ 找不到根 schema 时明说 no-root-schema', schemaHints('const a = 1;').unverifiable.some((u) => u.kind === 'no-root-schema'));
console.log('— 夹具 41：按卡的 Zod 结构强制写入（0.13.0）');
const o41 = { clamps: h40.clamps, bounds: h40.bounds, types: h40.types, enums: h40.enums, objects: h40.objects, defaults: h40.defaults };
const b41 = { 林婉婷: { 关系态度: 90, 经济: { 现金: 500 }, 身体状态: { 嘴巴: { 总次数: 1 } } }, 系统: { 时间: '14:00' } };
check('① 夹取现在真的命中（90 + 50 → 100）', applyVarOps(b41, [{ op: 'delta', path: '/林婉婷/关系态度', value: 50 }], o41).state['林婉婷']['关系态度'] === 100);
check('① replace 超界也夹（999 → 100）', applyVarOps(b41, [{ op: 'replace', path: '/林婉婷/堕落进度', value: 999 }], o41).state['林婉婷']['堕落进度'] === 100);
check('② coerce.number 接受数字字符串', (function () { const r = applyVarOps(b41, [{ op: 'replace', path: '/林婉婷/经济/现金', value: '750' }], o41); return r.state['林婉婷']['经济']['现金'] === 750 && r.schemaHits.length === 0; })());
check('② 非数字串 → 跳过 + schemaHits（不静默）', (function () { const r = applyVarOps(b41, [{ op: 'replace', path: '/林婉婷/经济/现金', value: '很多钱' }], o41); return r.state['林婉婷']['经济']['现金'] === 500 && r.schemaHits.length === 1 && r.skipped.some((s) => s.reason.indexOf('schema') >= 0); })());
check('② z.string()（无 coerce）写数字 → 跳过并记账', (function () { const r = applyVarOps(b41, [{ op: 'replace', path: '/系统/时间', value: 123 }], o41); return r.state['系统']['时间'] === '14:00' && r.schemaHits.length === 1; })());
check('② record 展开出的路径同样受约束（身体状态.嘴巴.总次数）', (function () { const r = applyVarOps(b41, [{ op: 'replace', path: '/林婉婷/身体状态/嘴巴/总次数', value: '三' }], o41); return r.state['林婉婷']['身体状态']['嘴巴']['总次数'] === 1 && r.schemaHits.length === 1; })());
check('③ 枚举：非法取值被拦、合法放行', (function () { const h = schemaHints('export const Schema = z.object({ s: z.enum(["x", "y"]) });'); const bad = applyVarOps({ s: 'x' }, [{ op: 'replace', path: '/s', value: 'z' }], h); const ok = applyVarOps({ s: 'x' }, [{ op: 'replace', path: '/s', value: 'y' }], h); return bad.state['s'] === 'x' && bad.schemaHits.length === 1 && ok.state['s'] === 'y' && ok.schemaHits.length === 0; })());
check('③ .min/.max 参与夹取（bounds 与 clamps 取交集）', (function () { const h = schemaHints('export const Schema = z.object({ n: z.coerce.number().min(0).max(10) });'); return applyVarOps({ n: 5 }, [{ op: 'delta', path: '/n', value: 20 }], h).state['n'] === 10; })());
check('④ 只在 schema 声明为对象时才建中间层', (function () { const good = applyVarOps({}, [{ op: 'insert', path: '/林婉婷/经济/现金', value: 7 }], o41); const bad = applyVarOps({}, [{ op: 'insert', path: '/林婉婷/没有这个/字段', value: 7 }], o41); return good.state['林婉婷']['经济']['现金'] === 7 && !bad.state['林婉婷']['没有这个']; })());
check('⑤ prefault 默认值补齐：只补 undefined，不覆盖已有值', (function () { const f = fillSchemaDefaults({ 林婉婷: { 经济: { 现金: 999 } } }, h40.defaults); return f['林婉婷']['经济']['现金'] === 999 && f['林婉婷']['经济']['欠款'] === 0 && f['系统']['日期'] === '待初始化'; })());
check('⑤ schemaGuard:false 时完全不校验（安全阀）', (function () { const r = applyVarOps(b41, [{ op: 'replace', path: '/系统/时间', value: 123 }], Object.assign({}, o41, { schemaGuard: false })); return r.state['系统']['时间'] === 123 && r.schemaHits.length === 0; })());
check('⑥ planFloorFixes 把 schemaHits 带出来（面板可显示）', (function () { const stored = [{ 系统: { 时间: '14:00' } }, { 系统: { 时间: '14:00' } }]; const ops = [[], [{ op: 'replace', path: '/系统/时间', value: 123 }]]; const pl = planFloorFixes(stored, ops, { 系统: { 时间: '14:00' } }, o41); return (pl[1].schemaHits || []).length === 1; })());
check('⑦ 扩展接线（schemaGuard 开关 / 面板摘要行 / var-schema 日志 / 全量 hints 传入引擎）', idxSrc.indexOf("cb('cc-schema-guard', 'schemaGuard')") > 0 && idxSrc.indexOf('renderSchemaLine') > 0 && idxSrc.indexOf("'var-schema'") > 0 && /types: hints.types/.test(idxSrc) && /objects: hints.objects/.test(idxSrc) && /defaults: hints.defaults/.test(idxSrc) && /bounds: hints.bounds/.test(idxSrc));
check('⑧ 版本号已到 0.13.0', versionWired());

console.log('— 夹具 42：语料实测补的规则（别名内联 / z.array 元素 / .int() / .catch() / transform 白名单）');
const S42 = [
    'const num = z.coerce.number().transform(v => Math.max(0, v)).prefault(0).catch(0);',
    'const 身体状态 = z.enum(["常态", "情动"]);',
    'const 条目 = z.object({ 名: z.string(), 数量: z.coerce.number() });',
    'export const Schema = z.object({',
    '  n: num,',
    '  s: 身体状态,',
    '  c: z.coerce.number().int().catch(5),',
    '  f: z.coerce.number().transform(v => Math.floor(v)),',
    '  list: z.array(条目),',
    '  names: z.array(z.string()),',
    '  keep: z.record(z.string(), z.coerce.number()).transform(data => _.pickBy(data, n => n > 0)),',
    '});',
].join(NL);
const o42 = schemaHints(S42);
check('① 非 object 别名内联（const num / const 身体状态 = z.enum）', o42.types.some((t) => t.path.join('.') === 'n' && t.type === 'number') && o42.enums.some((e) => e.path.join('.') === 's' && e.values.join(',') === '常态,情动'), o42.enums);
check('① Math.max(0, v) transform → 下界 0', o42.bounds.some((b) => b.path.join('.') === 'n' && b.min === 0), o42.bounds);
check('① .catch(0) / .catch(5) 被解析（zod 的兜底语义）', o42.catches.some((c) => c.path.join('.') === 'n' && c.value === 0) && o42.catches.some((c) => c.path.join('.') === 'c' && c.value === 5), o42.catches);
check('① .int() 记进 ints', o42.ints.some((x) => x.path.join('.') === 'c'), o42.ints);
check('① Math.floor transform 记进 rounds', o42.rounds.some((r) => r.path.join('.') === 'f' && r.mode === 'floor'), o42.rounds);
check('① z.array(helper) 用 * 展开元素结构', o42.types.some((t) => t.path.join('.') === 'list.*.数量' && t.type === 'number'), o42.types.filter((t) => t.path[0] === 'list').map((t) => t.path.join('.')));
check('① z.array(z.string()) 元素类型也拿得到', o42.types.some((t) => t.path.join('.') === 'names.*' && t.type === 'string'), o42.types.filter((t) => t.path[0] === 'names').map((t) => t.path.join('.')));
check('① 任意 transform（_.pickBy）仍然如实标 unverifiable（不假装能执行）', o42.unverifiable.some((u) => u.kind === 'transform' && u.path.join('.') === 'keep'), o42.unverifiable);
check('② .catch() 生效：非法数字串 → 用兜底值且不报错', (function () { const r = applyVarOps({ n: 1, c: 3 }, [{ op: 'replace', path: '/c', value: '不是数字' }], o42); return r.state['c'] === 5 && r.schemaHits.length === 0; })());
check('② .int()：小数取整（对齐 zod .int() 的整数意图）', applyVarOps({ c: 1 }, [{ op: 'replace', path: '/c', value: 2.6 }], o42).state['c'] === 3);
check('② Math.floor transform：小数向下取整', applyVarOps({ f: 1 }, [{ op: 'replace', path: '/f', value: 2.9 }], o42).state['f'] === 2);
check('② Math.max(0,v) 下界：负数被抬到 0', applyVarOps({ n: 1 }, [{ op: 'replace', path: '/n', value: -5 }], o42).state['n'] === 0);
check('② 枚举别名内联后仍然拦非法取值', (function () { const r = applyVarOps({ s: '常态' }, [{ op: 'replace', path: '/s', value: '乱写' }], o42); return r.state['s'] === '常态' && r.schemaHits.length === 1; })());
check('③ 扩展接线（新约束全部传进引擎 + 面板摘要含整数/catch/取整）', /ints: hints.ints/.test(idxSrc) && /catches: hints.catches/.test(idxSrc) && /rounds: hints.rounds/.test(idxSrc) && /coerces: hints.coerces/.test(idxSrc) && idxSrc.indexOf("T('schInt')") > 0 && idxSrc.indexOf("T('schCatch')") > 0);
check('④ 无法离线校验的约束在「写变量这一刻」也提示（不只在面板躺着）', idxSrc.indexOf('function unverKinds(') > 0 && idxSrc.indexOf("'var-unverified'") > 0 && idxSrc.indexOf("T('varUnverified'") > 0 && idxSrc.indexOf('const caveat = unver.length') > 0 && idxSrc.indexOf('vunverKinds(unver)') < 0 && idxSrc.indexOf('unverKinds(unver)') > 0);
check('⑤ 切卡后不再沿用上一张卡的表（0.13.2）：buildReport / refreshReport / watchCard 接线', idxSrc.indexOf('function buildReport(') > 0 && idxSrc.indexOf('function refreshReport(') > 0 && idxSrc.indexOf('function watchCard(') > 0 && idxSrc.indexOf('let cardKey =') > 0 && idxSrc.indexOf('setInterval(watchCard') > 0 && idxSrc.indexOf('refreshReport(0);') > 0 && idxSrc.indexOf('cardKey = cardKeyNow();') > 0);
check('⑤ 报表头写明「本卡」并处理无规则卡；buildReport 里先挂 lastReport 再 log', idxSrc.indexOf("T('reportCard')") > 0 && idxSrc.indexOf("T('noRequired')") > 0 && idxSrc.indexOf('lastReport = report;') > 0 && idxSrc.indexOf('for (let i = total - 1; i >= 0; i--) { if (chat[i] && !chat[i].is_user)') > 0);
check('⑤ 报表行去重（同路径只渲染一次）', idxSrc.indexOf('const seenRow = new Set();') > 0 && idxSrc.indexOf('if (!f || seenRow.has(f.path)) continue;') > 0);
check('⑤ 版本号已到 0.13.2', versionWired());

console.log('');
console.log('— 夹具 43：0.14.x 审计修复回归（每条先做过独立反例验证，这里固化防回归）');
// C5 模板组展开上限（原先 8 组×10 = 1 亿条、主线程卡死）
const tplOverflow = expandTemplateGroups(['系统.' + Array.from({ length: 8 }, (_, i) => '{' + Array.from({ length: 10 }, (_, j) => 'g' + i + '_' + j).join('|') + '}').join('.')]);
check('⑬ 模板组爆炸输入被截断（≤2000 条）', tplOverflow.length <= 2000 && tplOverflow.length > 0, tplOverflow.length);
check('⑬ 小样例仍正常展开（两组各自展开）', JSON.stringify(expandTemplateGroups(['角色.{林婉婷|陈慧兰}.关系态度']).sort()) === JSON.stringify(['角色.林婉婷.关系态度', '角色.陈慧兰.关系态度']));
// C6 补丁块里的方括号说明不再毁掉整段补丁
check('⑥ 块内「（说明：[已更新]）」仍能解析出补丁', parsePatchOps('<JSONPatch>[{"op":"replace","path":"/a","value":1}]（说明：[已更新]）</JSONPatch>').ops.length === 1);
check('⑥ 前置「分析[1]:」仍能解析出补丁', parsePatchOps('<JSONPatch>分析[1]: [{"op":"replace","path":"/b","value":2}]</JSONPatch>').ops.length === 1);
check('⑥ 字符串值里的方括号不影响解析', parsePatchOps('<JSONPatch>[{"op":"replace","path":"/c","value":"数组[0]与]括号"}]</JSONPatch>').ops.length === 1);
// C7 YAML 加引号时反斜杠必须转义（原先 C:\\new 会被解析成换行）
const bs = String.fromCharCode(92);   // 反斜杠：写成字面量容易在源码里被转义，这里显式生成
const yamlIn = '<B>' + String.fromCharCode(10) + ' 路径: C:' + bs + 'new # 重要' + String.fromCharCode(10) + '</B>';
const yamlBs = guardBlockYaml(yamlIn, ['B']).text;
check('⑦ 反斜杠已转义（输出含双反斜杠）', yamlBs.indexOf('C:' + bs + bs + 'new') >= 0, yamlBs);
check('⑦ 不会把反斜杠吃成换行', yamlBs.indexOf('C:' + String.fromCharCode(10) + 'new') < 0);
// C8 前缀标签：干净数据不该被误改
const cleanStatus = '<StatusBar>ok</StatusBar>';
check('⑧ 合法的 </StatusBar> 不被前缀标签逻辑破坏', normalizeMalformedClosings(cleanStatus, ['Status']).text === cleanStatus);
// C10 变量块抽取大小写不敏感（与 detectVariableProtocol 同口径）
check('⑩ 小写 <updatevariable> 也能抽出块', extractUpdateBlocks('<updatevariable><JSONPatch>[{"op":"replace","path":"/x","value":1}]</JSONPatch></updatevariable>').length === 1);
check('⑩ 大写 <UPDATEVARIABLE> 也能抽出块', !!extractUpdateBlock('<UPDATEVARIABLE>x</UPDATEVARIABLE>'));
// C3 move 目标不可建时不得丢源值
const mv = applyVarOps({ a: { b: 1 } }, [{ op: 'move', from: '/a/b', path: '/x/y' }], { objects: [['a']] });
check('③ move 目标不可建 → 源值保留、并记 skipped', mv.state.a && mv.state.a.b === 1 && mv.skipped.length === 1);
// C13 命令解析：嵌套括号与 insert/delete/move
check('⑬ 嵌套括号不再截断（Number(基础值) 完整保留）', parseSetCommands('_.set("角色.金钱", Number(基础值))')[0].value === 'Number(基础值)');
check('⑬ _.delete 映射为 remove', parseSetCommands('_.delete("旧字段")')[0].op === 'remove');
check('⑬ _.insert 映射为 insert', parseSetCommands('_.insert("列表", "x")')[0].op === 'insert');
const mvOp = parseSetCommands('_.move("a.b", "c.d")')[0];
check('⑬ _.move 同时产出 from 与 path', mvOp.op === 'move' && mvOp.from === 'a.b' && mvOp.path === 'c.d');
console.log('');
console.log('— 夹具 44：0.15.0 审计修复回归');
// C16 精确 type 优先于 all_variables 弱信号
check('⑯ character 型不被 all_variables 抢成 message', detectVarScope("getVariables({ type: 'character' })\n{{getvar::all_variables}}").scope === 'character');
check('⑯ chat 型同理优先', detectVarScope("getVariables({ type: 'chat' })").scope === 'chat');
check('⑯ 精确 message 仍判 message', detectVarScope("getVariables({ type: 'message' })").scope === 'message');
check('⑯ 只有 all_variables 的弱信号仍落到 message（保守）', detectVarScope('模板里出现 all_variables').scope === 'message');
// C12 只剥外层包裹引号，正文引号保留
const c12out = repairYamlStructure('穿搭: "长裙。", 他说"你好"');
const c12txt = (c12out && c12out.text) ? c12out.text : String(c12out || '');
check('⑫ 正文内的引号不被删除', c12txt.indexOf('他说"你好"') >= 0 || c12txt.indexOf('他说\\"你好\\"') >= 0, c12txt);
// C17 op 白名单 + move 必填 from + 祖先前缀
check('⑰ move 缺 from 被拒', validatePatchBlock('[{"op":"move","path":"/a/b"}]').ok === false);
check('⑰ 未知 op 被拒', validatePatchBlock('[{"op":"frobnicate","path":"/a"}]').ok === false);
check('⑰ 合法的 move 仍通过', validatePatchBlock('[{"op":"move","from":"/a/b","path":"/c/d"}]').ok === true);
check('⑰ delta/insert 是自家语法，不能被判非法', validatePatchBlock('[{"op":"delta","path":"/a","value":1}]').ok === true);

console.log('');
console.log('— 夹具 45：本卡诊断报告（0.16.0）');
const diagIn = {
    version: '0.16.0', at: Date.now(), card: '测试卡', floor: 12, host: '1.18.0', lang: 'zh', verdict: 'ok',
    profile: { anchors: ['StatusPlaceHolderImpl'], dataTags: ['UpdateVariable'], hideTargets: [], rawTags: [], helperCount: 2 },
    protocol: { id: 'mvu', canWriteBack: true },
    required: 49, allowed: 60, book: 12, scope: { scope: 'message', reason: 'message 变量' },
    schemaHints: { clamps: [1], bounds: [], types: [1], enums: [], defaults: [], objects: [1], ints: [], catches: [], rounds: [], unverifiable: [{ path: ['a'] }] },
    disabledViews: 14, disabledUncovered: 1,
    thisFloor: { verdict: '补丁没生效', blocks: 1, covered: 30, total: 49 },
    state: { advanced: ['系统.时间'], stuck: ['林婉婷.关系态度'], same: [], absent: ['user.现金'], noBase: false },
    guards: 3, removed: 1, yamlFixes: 2, floors: { written: 2, skipped: 1, guard: 1, schema: 3 }, schemaFails: 3,
    recent: ['12:00:02 var-stuck [2 字段] 写了但存储值没变', '12:00:03 yaml-strict-fail [B] 解析失败：xxx'],
};
const diagTxt = diagnosisReportText(diagIn);
check('㊺ 诊断报告含结论/协议/规则/状态核对段', ['【结论】', '【变量协议】', '【规则】', '【状态核对】'].every((s) => diagTxt.indexOf(s) >= 0));
check('㊺ 诊断报告带卡名与楼层（便于贴给卡作者）', diagTxt.indexOf('测试卡') >= 0 && diagTxt.indexOf('第 12 楼') >= 0);
check('㊺ 空输入不崩且仍是字符串', typeof diagnosisReportText({}) === 'string' && diagnosisReportText({}).length > 0);
const diagActs = diagnosisActions(diagIn);
check('㊺ 有「写了但没变」时给出补应用/MVU 重演建议', diagActs.some((a) => /补应用变量|重演楼层/.test(a)), diagActs);
check('㊺ 有被禁用渲染正则时提示去启用', diagActs.some((a) => /渲染正则/.test(a)));
check('㊺ 有无法离线校验约束时如实说明', diagActs.some((a) => /无法离线校验/.test(a)));
check('㊺ 无问题时给「没有发现明显问题」而不是空数组', diagnosisActions({ verdict: 'ok', profile: {} }).length > 0);
check('㊺ 纯正文卡只给一条「无需处理」', diagnosisActions({ verdict: 'plain', profile: {} }).length === 1);
check('㊺ no-rules 时提示去体检看原因分类', diagnosisActions({ verdict: 'no-rules', profile: {} }).some((a) => /兼容性体检/.test(a)));

console.log('');
console.log('— 夹具 46：占位值识别（未登场/未描述 不该打红叉，0.16.1）');
check('㊻ 未登场/未描述/未触发/未设定 判为占位', ['未登场', '未描述', '未触发', '未设定'].every((v) => isPlaceholderValue(v) === true));
check('㊻ 「无」不算占位（当前在做什么: 无 是合法值）', isPlaceholderValue('无') === false);
check('㊻ 正常值不算占位', isPlaceholderValue('user家客厅') === false && isPlaceholderValue(0) === false);
const phCur = { 陈慧兰: { 位置: '未登场', 外貌: { 发型: '未描述', 表情: '平静' }, 身体状态: { 嘴巴: { 状态: '干净' } } }, 林婉婷: { 位置: 'user家客厅' } };
check('㊻ 对象里的「状态」子键取到占位才算（身体状态.嘴巴=干净 → 不是）', isPlaceholderAt(phCur, '陈慧兰.身体状态.嘴巴') === false);
check('㊻ 路径式判定：位置=未登场 → 占位', isPlaceholderAt(phCur, '陈慧兰.位置') === true);
check('㊻ 模板组路径也能判定', isPlaceholderAt(phCur, '${林婉婷|陈慧兰}.位置') === true);
const phReq = [{ path: '陈慧兰.位置' }, { path: '陈慧兰.外貌.发型' }, { path: '陈慧兰.外貌.表情' }, { path: '林婉婷.位置' }];
const phDiff = stateDiffFields(phCur, JSON.parse(JSON.stringify(phCur)), phReq, []);
check('㊻ 未登场/未描述 进 pending 而不是 absent', phDiff.pending.length === 2 && phDiff.absent.indexOf('陈慧兰.位置') < 0, phDiff);
check('㊻ 正常值仍走 absent（真缺才报）', phDiff.absent.indexOf('林婉婷.位置') >= 0, phDiff.absent);

console.log('');
console.log('— 夹具 47：连续硬失败可见化（0.16.2）');
const ff1 = emptyFailStreak();
check('㊼ 空计数含四个类别且全为 0', FAIL_CATS.every((k) => ff1[k] === 0) && FAIL_CATS.length === 4);
const ffR1 = noteFailure(ff1, 'data', 1000000, { threshold: 3 });
const ffR2 = noteFailure(ff1, 'data', 1001000, { threshold: 3 });
check('㊼ 同类连续计数 1 → 2', ffR1.streak === 1 && ffR2.streak === 2);
check('㊼ 未到阈值不提醒', ffR1.alert === false && ffR2.alert === false && ffR2.reason === 'below-threshold');
const ffR3 = noteFailure(ff1, 'data', 1002000, { threshold: 3 });
check('㊼ 第 3 次触发提醒', ffR3.streak === 3 && ffR3.alert === true);
const ffR4 = noteFailure(ff1, 'data', 1003000, { threshold: 3, lastAt: 1002000, cooldownMs: 600000 });
check('㊼ 冷却期内不再提醒（但计数继续涨）', ffR4.alert === false && ffR4.reason === 'cooling-down' && ffR4.streak === 4);
const ffR5 = noteFailure(ff1, 'data', 2000000, { threshold: 3, lastAt: 1002000, cooldownMs: 600000 });
check('㊼ 冷却过后可再提醒', ffR5.alert === true);
noteFailure(ff1, 'data', 3000000, {});
const ffR6 = noteFailure(ff1, 'yaml', 3001000, {});
check('㊼ 换成另一类失败 → 自己从 1 开始、旧类别清零', ffR6.streak === 1 && ff1.data === 0 && ff1.yaml === 1);
const ffR7 = noteFailure(ff1, '不存在', 3002000, {});
check('㊼ 未知类别被忽略（不污染计数）', ffR7.alert === false && ffR7.reason === 'unknown-cat' && ff1.yaml === 1);
check('㊼ 传入空对象不崩', noteFailure(null, 'data', 1, {}).alert === false);

console.log('');
console.log('— 夹具 48：RFC 6902 语义补齐（0.16.3：add 插入 / copy / test）');
const rfBase = { a: { list: ['x', 'y', 'z'], n: 1 } };
const rf1 = applyVarOps(rfBase, [{ op: 'add', path: '/a/list/1', value: 'NEW' }]);
check('㊽ 数组 add 是插入而不是覆盖', JSON.stringify(rf1.state.a.list) === JSON.stringify(['x', 'NEW', 'y', 'z']), rf1.state.a.list);
const rf2 = applyVarOps(rfBase, [{ op: 'add', path: '/a/list/-', value: 'END' }]);
check('㊽ add 到 - 追加到末尾', JSON.stringify(rf2.state.a.list) === JSON.stringify(['x', 'y', 'z', 'END']));
const rf3 = applyVarOps(rfBase, [{ op: 'add', path: '/a/list/9', value: 'BIG' }]);
check('㊽ 越界下标退化为追加（不产生稀疏数组）', JSON.stringify(rf3.state.a.list) === JSON.stringify(['x', 'y', 'z', 'BIG']));
const rf4 = applyVarOps(rfBase, [{ op: 'add', path: '/a/k', value: 5 }]);
check('㊽ 对象 add 仍可新增键', rf4.state.a.k === 5 && rf4.skipped.length === 0);
const rf5 = applyVarOps(rfBase, [{ op: 'test', path: '/a/n', value: 1 }, { op: 'replace', path: '/a/n', value: 2 }]);
check('㊽ test 通过后继续执行后续 op', rf5.state.a.n === 2 && rf5.tested === 1 && rf5.aborted === false);
const rf6 = applyVarOps(rfBase, [{ op: 'test', path: '/a/n', value: 99 }, { op: 'replace', path: '/a/n', value: 2 }]);
check('㊽ test 失败 → 中止后续（n 保持原值）', rf6.state.a.n === 1 && rf6.aborted === true && rf6.tested === 0);
const rf7 = applyVarOps(rfBase, [{ op: 'copy', from: '/a/list', path: '/a/listCopy' }]);
rf7.state.a.list.push('MUT');
check('㊽ copy 是深拷贝（改副本不影响源）', rf7.state.a.listCopy.length === 3 && rf7.state.a.list.length === 4);
const rf8 = applyVarOps(rfBase, [{ op: 'copy', from: '/a/nope', path: '/a/x' }]);
check('㊽ copy 源不存在 → 记账跳过', rf8.skipped.length === 1 && rf8.state.a.x === undefined);
check('㊽ 校验器接受 copy / test（不再报未知 op）', validatePatchBlock('[{"op":"copy","from":"/a","path":"/b"}]').ok === true && validatePatchBlock('[{"op":"test","path":"/a","value":1}]').ok === true);

console.log('');
console.log('— 夹具 49：扩展样式表不得覆写卡的状态栏美化（0.16.4）');
const rfCss = readFileSync(new URL('../extensions/card-compat/style.css', import.meta.url), 'utf8');
const rfCssClean = rfCss.replace(/\/\*[\s\S]*?\*\//g, '');   // 先剥注释，否则注释会跟到选择器前面
const rfSel = rfCssClean.split('}').map((chunk) => chunk.split('{')[0].trim()).filter((s) => s && !s.startsWith('@') && s !== '');
const rfBad = rfSel.filter((s) => s.split(',').some((one) => { const q = one.trim(); return q && !/^#cc-panel\b|^#cc-var-bar\b|^\.cc-log-doc\b|^\.cc-log-head\b/.test(q); }));
check('㊾ 样式表所有选择器都在自有容器内（无全局泄漏）', rfBad.length === 0, rfBad.slice(0, 5));
check('㊾ 样式表不出现 .mes / .mes_text / body / html / :root', !/\.mes\b|\.mes_text\b|(^|[,{\s])body\b|(^|[,{\s])html\b|:root/.test(rfCssClean));
const rfSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('㊾ 字号/缩放默认关闭（fontZoom=1、fontFloor=0）', /fontZoom:\s*1,/.test(rfSrc) && /fontFloor:\s*0,/.test(rfSrc));
check('㊾ 覆写型开关带面板警告文案（fontWarn 中英各一）', (rfSrc.split("fontWarn:").length - 1) === 2);
check('㊾ 不手写状态栏 DOM（不出现往 .mes_text 注入 HTML 的写法）', !/\.mes_text[^\n]*innerHTML/.test(rfSrc));

console.log('');
console.log('— 夹具 50：符号说明必须印在面板上（0.17.0）');
const lgSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
const lgKeys = ['legendTitle', 'lgDone', 'lgMiss', 'lgSame', 'lgStuck', 'lgNoBase', 'lgPlaceholder'];
check('㊿ 七个图例键各出现两次（中英各一）', lgKeys.every((k) => (lgSrc.split(k + ':').length - 1) === 2), lgKeys.filter((k) => (lgSrc.split(k + ':').length - 1) !== 2));
check('㊿ 图例把符号字面印出来（含 ✅ ❌ ➖ ⚠️ ○ —）', ['✅', '❌', '➖', '⚠️', '○', '—'].every((s) => lgSrc.indexOf(s) >= 0));
check('㊿ 图例渲染代码存在于对照表渲染函数里（cc-legend）', lgSrc.indexOf('cc-legend') >= 0 && lgSrc.indexOf('lgItem(') >= 0);
const lgCss = readFileSync(new URL('../extensions/card-compat/style.css', import.meta.url), 'utf8');
check('㊿ 图例样式限定在 #cc-panel 内（不出现裸 .cc-legend 选择器）', (lgCss.split('.cc-legend').length - 1) === (lgCss.split('#cc-panel .cc-legend').length - 1));

console.log('');
console.log('— 夹具 51：统计改芯片组 + 趋势条（0.18.0 UI）');
const uiSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
const uiKeys = ['stVersion', 'stFixes', 'stRerender', 'stAnchor', 'stClose', 'stDataMiss', 'stStale', 'stDup', 'stBlocks', 'stUnclosed', 'stForeign', 'stCover', 'stMvuFail', 'stYamlStrict'];
check('51 十四个统计标签中英各一', uiKeys.every((k) => (uiSrc.split(k + ':').length - 1) === 2), uiKeys.filter((k) => (uiSrc.split(k + ':').length - 1) !== 2));
check('51 统计改用芯片网格（cc-chips / cc-chip）', uiSrc.indexOf('cc-chips') >= 0 && uiSrc.indexOf('cc-chip') >= 0);
check('51 旧的「一长串 ｜」统计行已移除', uiSrc.indexOf("' ｜ 修正 '") < 0 && uiSrc.indexOf("' ｜ 补锚点 '") < 0);
check('51 趋势改用可见条 + 百分比（renderTrend）', /function renderTrend\(\)/.test(uiSrc) && uiSrc.indexOf('cc-trend-bars') >= 0 && uiSrc.indexOf('cc-trend-pct') >= 0);
const uiCss = readFileSync(new URL('../extensions/card-compat/style.css', import.meta.url), 'utf8');
check('51 新样式仍限定在 #cc-panel 内', ['#cc-panel .cc-chips', '#cc-panel .cc-chip', '#cc-panel .cc-trend-bars'].every((s) => uiCss.indexOf(s) >= 0));
check('51 新样式不含裸全局选择器（.cc-chips/.cc-chip 不带前缀的写法）', (uiCss.split('.cc-chips').length - 1) === (uiCss.split('#cc-panel .cc-chips').length - 1) && (uiCss.split('.cc-chip ').length - 1) <= (uiCss.split('#cc-panel .cc-chip ').length - 1));

console.log('');
console.log('— 夹具 52：未声明块清理不得误删世界书条目名（0.19.0）');
const bsText = '正文开始。' + String.fromCharCode(10) + '<世界设定>这是一段设定</世界设定>' + String.fromCharCode(10) + '<status_block>状态</status_block>' + String.fromCharCode(10) + '结尾。';
const bsNoTitles = stripUndeclaredBlocks(bsText, { declared: [], keep: KEEP_BLOCKS });
check('52 没有条目名单时：两个未声明块都被清理', bsNoTitles.removed.length === 2 && bsNoTitles.text.indexOf('世界设定') < 0 && bsNoTitles.text.indexOf('status_block') < 0);
const bsWithTitles = stripUndeclaredBlocks(bsText, { declared: [], keep: KEEP_BLOCKS, bookTitles: ['世界设定'] });
check('52 条目名在名单里 → 不清理，且记进 keptAsTitle', bsWithTitles.text.indexOf('<世界设定>') >= 0 && bsWithTitles.keptAsTitle.indexOf('世界设定') >= 0);
check('52 名单里没有的块照常清理', bsWithTitles.removed.length === 1 && bsWithTitles.removed[0].tag === 'status_block');
const bsKey = stripUndeclaredBlocks('<WORLD_setting>数据</WORLD_setting>', { declared: [], keep: KEEP_BLOCKS, bookTitles: ['WORLD_setting'] });
check('52 keys 里的条目名同样受保护（大小写不敏感）', bsKey.removed.length === 0 && bsKey.keptAsTitle.length === 1);
const bsDeclared = stripUndeclaredBlocks(bsText, { declared: ['世界设定'], keep: KEEP_BLOCKS });
check('52 卡自己声明的标签仍走原路径（不报未声明）', bsDeclared.removed.length === 1 && bsDeclared.removed[0].tag === 'status_block');

console.log('');
console.log('— 夹具 53：面板字号必须有可读下限（0.19.1 UI）');
const fcCss = readFileSync(new URL('../extensions/card-compat/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const fcRoot = (fcCss.match(/#cc-panel\s*\{([\s\S]*?)\}/) || [])[1] || '';
check('53 面板根字号带 max() 可读下限', /font-size:\s*max\(\s*13\.5px/.test(fcRoot));
const fcRules = [...fcCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] })).filter((r) => /^#cc-panel\b/.test(r.sel));
const fcBase = Math.max(13.5, 13 * 1.1);   // 假设 ST 根字号 13px + --cc-font 默认 1.1em
const fcSmall = [];
for (const r of fcRules) { const m = r.body.match(/font-size:\s*([^;]+);/); if (!m) continue; const v = m[1].trim(); if (/inherit|max\(/.test(v)) continue; const px = /px$/.test(v) ? parseFloat(v) : (/em$/.test(v) ? fcBase * parseFloat(v) : null); if (px != null && px < 13) fcSmall.push(r.sel.replace(/\s+/g, ' ').slice(0, 40) + '=' + px.toFixed(1) + 'px'); }
check('53 面板内没有低于 13px 的字号（含 ST 界面偏小时）', fcSmall.length === 0, fcSmall);
const fcSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('53 panelFont 默认值 ≥ 1.1', /panelFont:\s*1\.1,/.test(fcSrc));
check('53 --cc-font 注入带 1.1 兜底', /panelFont\) \|\| 1\.1/.test(fcSrc));

console.log('');
console.log('— 夹具 54：资金流体检（0.20.0，来自用户实测：给了 3000 现金但状态栏没变）');
// 真实楼层 #11 的补丁：只有支出记账，没有任何现金路径
const mfReal11 = '[{"op":"replace","path":"/系统/时间","value":"14:50"},{"op":"delta","path":"/user/累计支出_林婉婷","value":3000}]';
const mfBody11 = '染伸出手，从腰侧摸出了三千块沉甸甸的现金，稳稳地塞进了林婉婷的手心里。';
const mf1 = moneyFlowHint(mfBody11, mfReal11, { minAmount: 500 });
check('54 真实案例：正文提到 3000 现金但补丁无现金字段 → 报警', !!mf1 && mf1.missingCash === true && mf1.amount === 3000, mf1);
check('54 金额解析：汉字数字也算（三千块=3000 / 五百元=500 / 两万块=20000）', moneyAmountOf('三千块') === 3000 && moneyAmountOf('五百元') === 500 && moneyAmountOf('两万块') === 20000);
check('54 「两万人」不会被当成钱', moneyAmountOf('两万人') === null);
check('54 金额解析：阿拉伯数字带单位能抓到', moneyAmountOf('掏出了3000现金给她') === 3000);
const mf2 = moneyFlowHint('她掏出 5000 元现金', '[{"op":"replace","path":"/林婉婷/经济/现金","value":5000}]', { minAmount: 500 });
check('54 补丁里有现金字段 → 不报警（真实楼层 #5 那种）', mf2 && mf2.missingCash === false && mf2.hasCash === true);
check('54 金额低于门槛 → 不打扰（默认 500）', moneyFlowHint('给了 200 元', '[{"op":"delta","path":"/user/累计支出_林婉婷","value":200}]') === null);
check('54 只是提到钱、补丁完全没资金字段 → 也报（hint=no-money-path）', (() => { const r = moneyFlowHint('桌上放着 800 元', '[{"op":"replace","path":"/系统/时间","value":"15:00"}]'); return r && r.missingCash && r.hint === 'no-money-path'; })());
check('54 资金路径识别覆盖 欠款/钱包/资产/余额', moneyPathsIn('[{"path":"/林婉婷/经济/欠款"},{"path":"/user/钱包"},{"path":"/a/资产"},{"path":"/b/余额"}]').length === 4);
check('54 归一化：不带前导 / 的路径也能识别', moneyPathsIn('[{"path":"林婉婷/经济/现金"}]')[0] === '/林婉婷/经济/现金');

console.log('');
console.log('— 夹具 55：资金账目对账（0.20.0，来自用户实测「统计金额不对」）');
// 真实聊天逐层还原（planned = 模型补丁里的金额；stored/prevStored = 账本值）
const ledgerRows = [
    { floor: 1, ops: [], stored: 0, prevStored: null },
    { floor: 3, ops: [], stored: 2500, prevStored: 0 },          // 无补丁却涨了 2500 → 这一层是「计划 0 / 实际 2500」，但因 planned=0 不算不一致（对账只比有计划的层）
    { floor: 5, ops: [{ op: 'delta', path: '/user/累计支出_林婉婷', value: 2500 }], stored: 2500, prevStored: 2500 },
    { floor: 9, ops: [{ op: 'delta', path: '/user/累计支出_林婉婷', value: 2500 }], stored: 5000, prevStored: 2500 },
    { floor: 11, ops: [{ op: 'delta', path: '/user/累计支出_林婉婷', value: 3000 }], stored: 8000, prevStored: 5000 },
];
const ledger = moneyLedgerDrift(ledgerRows);
check('55 对账只挑出「有计划但没落地」的那一层（#5）', ledger.mismatches.length === 1 && ledger.mismatches[0].floor === 5 && ledger.mismatches[0].planned === 2500 && ledger.mismatches[0].actual === 0, ledger.mismatches);
check('55 落地正确的层不误报（#9/#11）', ledger.mismatches.every((m) => m.floor !== 9 && m.floor !== 11));
check('55 replace 型金额也能算差值（prev 30 → 50 = +20）', (() => { const r = moneyLedgerDrift([{ floor: 1, ops: [{ op: 'replace', path: '/林婉婷/关系态度', value: 50 }], stored: 50, prevStored: 30, prevState: { 林婉婷: { 关系态度: 30 } } }]); return r.mismatches.length === 0; })());
check('55 没有计划金额的层不参与对账（不制造噪音）', (() => { const r = moneyLedgerDrift([{ floor: 1, ops: [{ op: 'replace', path: '/系统/时间', value: '15:00' }], stored: 8000, prevStored: 8000 }]); return r.checked === 0 && r.mismatches.length === 0; })());
check('55 空输入不崩', moneyLedgerDrift(null).mismatches.length === 0);

console.log('');
console.log('— 夹具 56：资金纠正建议（0.21.0，从「只能诊断」到「能补」）');
const mcState = { user: { 累计支出_林婉婷: 5000 }, 林婉婷: { 经济: { 现金: 500, 欠款: 500 } } };
const mcPatch11 = '[{"op":"delta","path":"/user/累计支出_林婉婷","value":3000}]';
const mc1 = moneyCorrection({ amount: 3000, patchText: mcPatch11, state: mcState, minAmount: 500 });
check('56 有累计支出锚点 → 给出「给林婉婷加 3000 现金」', mc1.ok === true && mc1.actions.length === 1 && mc1.actions[0].path === '/林婉婷/经济/现金' && mc1.actions[0].delta === 3000, mc1);
check('56 补丁里已有现金路径 → 不给建议（不重复补）', moneyCorrection({ amount: 3000, patchText: '[{"op":"delta","path":"/林婉婷/经济/现金","value":3000}]', state: mcState }).ok === false);
check('56 金额低于门槛 → 不给建议', moneyCorrection({ amount: 100, patchText: mcPatch11, state: mcState }).ok === false);
check('56 没有 累计支出 锚点 → 不给建议（不猜方向）', moneyCorrection({ amount: 3000, patchText: '[{"op":"replace","path":"/系统/时间","value":"15:00"}]', state: mcState }).reason === 'no-spend-anchor');
check('56 找不到对应角色的现金路径 → 不给建议', moneyCorrection({ amount: 3000, patchText: '[{"op":"delta","path":"/user/累计支出_不存在的人","value":3000}]', state: mcState }).ok === false);
check('56 没有变量基线 → 拒绝代写', moneyCorrection({ amount: 3000, patchText: mcPatch11, state: null }).reason === 'no-state');

console.log('');
console.log('— 夹具 57：资金纠正的安全边界（0.21.1）');
const mcCapState = { user: { 累计支出_A: 0 }, A: { 现金: 100 } };
const mcBig = '[{"op":"delta","path":"/user/累计支出_A","value":999999}]';
check('57 金额超过上限（默认 10 万）→ 不给建议，防解析错误写入离谱金额', moneyCorrection({ amount: 999999, patchText: mcBig, state: mcCapState }).reason === 'delta-too-large');
check('57 上限可自行放宽', moneyCorrection({ amount: 999999, patchText: mcBig, state: mcCapState, maxDelta: 2000000 }).ok === true);
const mcObjState = { user: { 累计支出_A: 0 }, A: { 现金: { 元: 100 } } };
check('57 目标字段是对象/非数字 → 不给建议（避免把对象写成数字）', moneyCorrection({ amount: 3000, patchText: '[{"op":"delta","path":"/user/累计支出_A","value":3000}]', state: mcObjState }).ok === false);

console.log('');
console.log('— 夹具 58：资金纠正必须吃「真实补丁格式」（带空格的 pretty JSON，0.21.2 回归）');
const mpState = { user: { 累计支出_林婉婷: 5000 }, 林婉婷: { 经济: { 现金: 500 } } };
const mpPretty = '[' + String.fromCharCode(10) + '  { "op": "delta", "path": "/user/累计支出_林婉婷", "value": 3000 },' + String.fromCharCode(10) + '  { "op": "replace", "path": "/系统/时间", "value": "14:50" }' + String.fromCharCode(10) + ']';
check('58 只给文本（带空格）也能推导出建议', (() => { const r = moneyCorrection({ amount: 3000, patchText: mpPretty, state: mpState }); return r.ok === true && r.actions[0].path === '/林婉婷/经济/现金' && r.actions[0].delta === 3000; })());
check('58 传已解析 ops 时结果一致（扩展线上走这条）', (() => { const r = moneyCorrection({ amount: 3000, ops: JSON.parse(mpPretty), patchText: mpPretty, state: mpState }); return r.ok === true && r.actions[0].delta === 3000; })());
check('58 紧凑 JSON（无空格）同样可用', (() => { const r = moneyCorrection({ amount: 3000, patchText: '[{"op":"delta","path":"/user/累计支出_林婉婷","value":3000}]', state: mpState }); return r.ok === true; })());

console.log('');
console.log('— 夹具 59：${} 包裹路径的还原（0.21.3，实测「数据不更新」的根因）');
check('59 unwrapPathWrapper: ${/a/b} → /a/b', unwrapPathWrapper('${/a/b}') === '/a/b');
check('59 unwrapPathWrapper: {{/a/b}} → /a/b', unwrapPathWrapper('{{/a/b}}') === '/a/b');
check('59 unwrapPathWrapper: 残缺 ${/a/b → /a/b', unwrapPathWrapper('${/a/b') === '/a/b');
check('59 unwrapPathWrapper: 干净路径不动', unwrapPathWrapper('/林婉婷/穿搭') === '/林婉婷/穿搭' && unwrapPathWrapper('林婉婷.穿搭') === '林婉婷.穿搭');
check('59 normalizePath 也能还原并补前导斜杠', normalizePath('${/林婉婷/穿搭}') === '/林婉婷/穿搭');
const wpState = { 系统: { 时间: '14:00' }, user: { 累计支出_林婉婷: 0 }, 互动次数: { 林婉婷与user: 0 } };
const wpRaw = '[' + String.fromCharCode(10) + '  { "op": "replace", "path": "${/系统/时间}", "value": "14:30" },' + String.fromCharCode(10) + '  { "op": "delta", "path": "${/user/累计支出_林婉婷}", "value": 1500 },' + String.fromCharCode(10) + '  { "op": "delta", "path": "{{/互动次数/林婉婷与user}}", "value": 1 }' + String.fromCharCode(10) + ']';
const wpParsed = parsePatchOps(wpRaw);
check('59 parsePatchOps 统计出 3 条被包裹并全部还原', wpParsed.wrapped === 3 && wpParsed.ops.every((x) => x.path.charAt(0) === '/'), wpParsed.ops.map((x) => x.path));
const wpApplied = applyVarOps(wpState, wpParsed.ops, { overdraftGuard: false });
check('59 还原后 3 条 op 全部落地（旧版会全被跳过）', wpApplied.applied.length === 3 && wpApplied.skipped.length === 0, wpApplied.skipped);
check('59 值确实变了（时间/支出/互动次数）', wpApplied.state['系统']['时间'] === '14:30' && wpApplied.state['user']['累计支出_林婉婷'] === 1500 && wpApplied.state['互动次数']['林婉婷与user'] === 1);
check('59 valueAtPath 也认包裹路径', valueAtPath(wpState, '${/系统/时间}') === '14:00');

console.log('');
console.log('— 夹具 60：插件总开关 + 功能开关（0.22.0）');
const swSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('60 两个功能开关有默认值（moneyCheck / moneyFix 默认开）', /moneyCheck:\s*true,/.test(swSrc) && /moneyFix:\s*true,/.test(swSrc));
const swKeys = ['switchTitle', 'switchOn', 'switchOff', 'moneyCheck', 'moneyFix', 'moneyFixOff'];
check('60 开关文案中英各一', swKeys.every((k) => (swSrc.split(k + ": '").length - 1) === 2), swKeys.filter((k) => (swSrc.split(k + ": '").length - 1) !== 2));
check('60 总开关放在面板最上面（cc-enabled 出现在 cc-stats 之前）', swSrc.indexOf("id=\"cc-enabled\"") > 0 && swSrc.indexOf("id=\"cc-enabled\"") < swSrc.indexOf("id=\"cc-stats\""));
check('60 总开关只有一个实例（不会出现两个同 id 的 checkbox）', (swSrc.split("id=\"cc-enabled\"").length - 1) === 1);
check('60 两个功能开关都绑定了 input 事件', swSrc.indexOf("bind('cc-money-check', 'moneyCheck', true)") > 0 && swSrc.indexOf("bind('cc-money-fix', 'moneyFix', true)") > 0);
check('60 资金计算受 moneyCheck 控制（关闭就不算）', swSrc.indexOf('sMoney.moneyCheck !== false') > 0 || (swSrc.split('sMoney.moneyCheck !== false').length - 1) >= 1);
check('60 资金纠正按钮受 moneyFix 控制', swSrc.indexOf('sMoney.moneyFix !== false') > 0);
check('60 写入函数里也有开关兜底（开关关了直接拒绝写）', /function applyMoneyFix[\s\S]{0,240}moneyFix === false/.test(swSrc));
check('60 状态文字随开关更新（renderStats 里写 cc-master-state）', swSrc.indexOf("getElementById('cc-master-state')") > 0);
const swCss = readFileSync(new URL('../extensions/card-compat/style.css', import.meta.url), 'utf8');
check('60 总开关样式限定在 #cc-panel 内', (swCss.split('.cc-master').length - 1) === (swCss.split('#cc-panel .cc-master').length - 1));

console.log('');
console.log('— 夹具 61：状态表写回（0.23.0，实测「回复里明明写了新状态却不更新」）');
const stTable = [
    '系统:',
    '  时间: 14:25',
    '  地点: user家客厅/房间',
    '林婉婷:',
    '  穿搭: 黑色露脐短上衣（略显凌乱），高腰牛仔短裤',
    '  当前在做什么: 完成全套服务的第一次性交',
    '  关系态度: 35',
    '  身体状态:',
    '    嘴巴: 干净... (省略其余相同状态)',
    'user:',
    '  累计支出_林婉婷: 2500',
].join(NL);
const stMes = '<status_current_variables>' + String.fromCharCode(10) + stTable + String.fromCharCode(10) + '</status_current_variables>' + String.fromCharCode(10) + '<tucao>正文</tucao>';
const stFound = extractStatusTable(stMes);
check('61 能抽出状态表块', !!stFound && stFound.tag === 'status_current_variables' && stFound.body.indexOf('穿搭') >= 0);
check('61 没有状态表时返回 null', extractStatusTable('<tucao>无表</tucao>') === null);
const stParsed = parseStatusTable(stMes);
check('61 内置解析器就能解析（不依赖 js-yaml）', stParsed.ok === true && stParsed.issues.length === 0, stParsed.issues);
check('61 解析出嵌套字段', stParsed.data['林婉婷']['穿搭'].indexOf('黑色露脐短上衣') >= 0 && stParsed.data['系统']['时间'] === '14:25');
const stPrev = { 系统: { 时间: '14:00', 地点: 'user家门口', 天气: '晴' }, 林婉婷: { 穿搭: '旧穿搭', 心情: '正常', 身体状态: { 嘴巴: { 状态: '干净', 总次数: 0 } } }, 陈慧兰: { 位置: '未登场' } };
const stMerged = mergeStatusTable(stPrev, stParsed.data);
check('61 深合并：表里有的被更新', stMerged['系统']['时间'] === '14:25' && stMerged['林婉婷']['穿搭'].indexOf('黑色露脐') >= 0);
check('61 深合并：表里没有的键保留旧值（应对「省略」行）', stMerged['系统']['天气'] === '晴' && stMerged['林婉婷']['心情'] === '正常' && stMerged['陈慧兰']['位置'] === '未登场');
check('61 「省略」行没有被当成数据', !('嘴巴' in (stParsed.data['林婉婷']['身体状态'] || {})) || typeof stParsed.data['林婉婷']['身体状态']['嘴巴'] !== 'string');
const stDiff = statusTableDiff(stPrev, stMerged, 40);
check('61 变化清单能列出时间/穿搭等', stDiff.length >= 3 && stDiff.some((c) => c.path === '系统/时间') && stDiff.some((c) => c.path === '林婉婷/穿搭'), stDiff.map((c) => c.path));
check('61 没变化时清单为空', statusTableDiff(stMerged, JSON.parse(JSON.stringify(stMerged))).length === 0);
const stSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('61 面板有写回按钮与委托', stSrc.indexOf('cc-table-write') > 0 && stSrc.indexOf('applyTableWrite') > 0);
check('61 写回走快照 + 撤销栈', /function applyTableWrite[\s\S]{0,2200}moneyFixStack\.push/.test(stSrc));
check('61 开关默认开且可关', /tableWrite:\s*true,/.test(stSrc) && stSrc.indexOf('bind(\'cc-table-write\', \'tableWrite\', true)') > 0);
check('61 只在「没有 JSONPatch」时才提示', /!\/<JSONPatch/.test(stSrc));

console.log('');
console.log('— 夹具 62：变量表绝不被清理 + 超大块安全阀（0.23.1，用户实测内容被删）');
const ktFields = ['林婉婷/穿搭', '林婉婷/心情', '林婉婷/当前在做什么', '系统/时间'];
const ktTable = '<status_current_variables>' + String.fromCharCode(10) + '系统:' + String.fromCharCode(10) + '  时间: 14:25' + String.fromCharCode(10) + '林婉婷:' + String.fromCharCode(10) + '  穿搭: 黑色皮衣' + String.fromCharCode(10) + '  心情: 亢奋' + String.fromCharCode(10) + '</status_current_variables>';
const kt1 = stripUndeclaredBlocks(ktTable + String.fromCharCode(10) + '<world_setting>回显的世界书原文</world_setting>', { declared: [], keep: KEEP_BLOCKS, knownFields: ktFields });
check('62 状态表标签永不清理（用户那块 2202 字就是它）', kt1.text.indexOf('<status_current_variables>') >= 0 && !kt1.removed.some((r) => r.tag === 'status_current_variables'));
check('62 真正该清的未声明块仍然被清（功能没被削弱）', kt1.removed.some((r) => r.tag === 'world_setting'));
const kt2 = stripUndeclaredBlocks('<konatan_planning~>计划内容</konatan_planning~>', { declared: [], keep: KEEP_BLOCKS });
check('62 尾部带 ~ 的保留标签（konatan_planning~）不再被清', kt2.removed.length === 0, kt2.removed);
const kt3 = stripUndeclaredBlocks('<我的状态表>' + String.fromCharCode(10) + '林婉婷:' + String.fromCharCode(10) + '  穿搭: 长裙' + String.fromCharCode(10) + '  心情: 平静' + String.fromCharCode(10) + '</我的状态表>', { declared: [], keep: KEEP_BLOCKS, knownFields: ktFields });
check('62 白名单外的标签，只要内容是变量表也不清（内容启发式）', kt3.removed.length === 0 && (kt3.keptAsTable || []).indexOf('我的状态表') >= 0, { removed: kt3.removed, kept: kt3.keptAsTable });
const ktBigBody = new Array(1501).join('x');
const kt4 = stripUndeclaredBlocks('<huge_block>' + ktBigBody + '</huge_block>', { declared: [], keep: KEEP_BLOCKS });
check('62 单块超过 1200 字不自动删，只报告（安全阀）', kt4.removed.length === 0 && kt4.keptTooBig.length === 1, kt4.keptTooBig);
const kt5 = stripUndeclaredBlocks('<small_block>短内容</small_block>', { declared: [], keep: KEEP_BLOCKS });
check('62 小块仍照常清理', kt5.removed.length === 1 && kt5.removed[0].tag === 'small_block');
const kt6 = stripUndeclaredBlocks('<huge_block>' + ktBigBody + '</huge_block>', { declared: [], keep: KEEP_BLOCKS, maxRemoveChars: 5000 });
check('62 上限可调（放宽后照常清理）', kt6.removed.length === 1);

console.log('');
console.log('— 夹具 63：重渲染必须优先走 ST 渲染通路（0.23.2，状态栏不出来的根因）');
const rrSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
const rrFn = rrSrc.slice(rrSrc.indexOf('function rerenderFloor'), rrSrc.indexOf('function rerenderFloor') + 900);
check('63 rerenderFloor 里 updateMessageBlock 出现在 refreshOneMessage 之前', rrFn.indexOf('updateMessageBlock') > 0 && rrFn.indexOf('updateMessageBlock') < rrFn.indexOf('refreshOneMessage'), { st: rrFn.indexOf('updateMessageBlock'), th: rrFn.indexOf('refreshOneMessage') });
check('63 酒馆助手只作兜底（在 !viaSt 判断之后）', /if \(!viaSt\)[\s\S]{0,300}refreshOneMessage/.test(rrFn));
check('63 走兜底时会记日志（该路不跑卡的正则）', rrFn.indexOf('rerender-fallback') > 0);
check('63 ST 渲染失败会记日志而不是静默', rrFn.indexOf('rerender-st-failed') > 0);
check('63 结尾仍补发 nudgeRender（让卡重画前端块）', rrFn.indexOf('nudgeRender(id)') > 0);

console.log('');
console.log('— 夹具 64：合并必须保类型 / 保结构（0.23.3，用户那张表的真实脏写法）');
const f64c1 = coerceToShape(0, '1000（预付全套）');
check('64 数字字段收到「1000（预付全套）」→ 保住数字 1000', f64c1.keep === true && f64c1.value === 1000 && typeof f64c1.value === 'number', f64c1);
check('64 数字字段收到纯文字 → 拒绝写（保住旧值）', coerceToShape(0, '很多钱').keep === false);
const f64ChestOld = { 状态: '干净', 总次数: 0, 当次次数: 0 };
const f64c2 = coerceToShape(f64ChestOld, '干净, 0, 0');
check('64 对象字段收到扁平「干净, 0, 0」→ 按旧键还原成对象', f64c2.keep === true && f64c2.value && f64c2.value['状态'] === '干净' && f64c2.value['总次数'] === 0 && f64c2.value['当次次数'] === 0, f64c2.value);
check('64 对象字段收到对不上号的分段 → 拒绝写', coerceToShape({ a: 1, b: 2 }, 'x, y, z').keep === false);
check('64 标量字段收到对象 → 拒绝写（不把结构写坏）', coerceToShape('旧文字', { x: 1 }).keep === false);
const f64Prev = { user: { 累计支出_林婉婷: 2500 }, 陈慧兰: { 身体状态: { 嘴巴: { 状态: '干净', 总次数: 0, 当次次数: 0 } } } };
const f64Parsed = { user: { 累计支出_林婉婷: '1000（预付全套）' }, 陈慧兰: { 身体状态: { 嘴巴: '干净, 0, 0' } } };
const f64Skip = []; const f64Co = [];
const f64Merged = mergeStatusTable(f64Prev, f64Parsed, { skipped: f64Skip, coerced: f64Co });
check('64 合并后 累计支出还是数字（否则 delta 会失效）', typeof f64Merged.user['累计支出_林婉婷'] === 'number' && f64Merged.user['累计支出_林婉婷'] === 1000);
check('64 合并后 陈慧兰.嘴巴 还是对象', f64Merged['陈慧兰']['身体状态']['嘴巴'] && typeof f64Merged['陈慧兰']['身体状态']['嘴巴'] === 'object');
check('64 还原与跳过都有记录（面板与弹窗要显示）', f64Co.length === 2 && f64Skip.length === 0, { co: f64Co.length, skip: f64Skip.length });
const f64Delta = applyVarOps(f64Merged, [{ op: 'delta', path: '/user/累计支出_林婉婷', value: 1000 }], { overdraftGuard: false });
check('64 合并后 delta 仍可用（钱能继续累加）', f64Delta.state.user['累计支出_林婉婷'] === 2000, f64Delta.skipped);
const f64Delta2 = applyVarOps(f64Merged, [{ op: 'delta', path: '/陈慧兰/身体状态/嘴巴/总次数', value: 1 }], { overdraftGuard: false });
check('64 合并后嵌套 delta 仍可用（总次数 0→1）', f64Delta2.state['陈慧兰']['身体状态']['嘴巴']['总次数'] === 1);
const f64Noise = [];
mergeStatusTable({}, { 林婉婷: { 位置: '沙发上，依偎在染身边' } }, { skipped: f64Noise });
check('64 中文逗号文案不会误报「扁平写法」', f64Noise.length === 0, f64Noise);
const f64Noise2 = [];
mergeStatusTable({}, { 陈慧兰: { 身体状态: { 嘴巴: '干净, 0, 0' } } }, { skipped: f64Noise2 });
check('64 真正的扁平元组才会被标记', f64Noise2.length === 1);

console.log('');
console.log('— 夹具 65：发送栏「按状态表写回」按钮（0.24.0）');
const sbSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('65 发送栏里有第二个按钮 #cc-var-table', sbSrc.indexOf("bt.id = 'cc-var-table'") > 0 && sbSrc.indexOf("bar.appendChild(bt)") > 0);
check('65 按钮默认隐藏，不做死按钮', sbSrc.indexOf("bt.style.display = 'none'") > 0 && sbSrc.indexOf('function refreshTableButton') > 0);
check('65 显隐由 refreshTableButton 决定，且 applyVarBar 会刷新它', /function applyVarBar\(\) \{[\s\S]{0,120}refreshTableButton\(\)/.test(sbSrc));
check('65 目标探测只在「有差异」时返回（无差异就不显示）', /function tableWriteTarget[\s\S]{0,1400}return n > 0 \? \{ id: i, n: n \} : null;/.test(sbSrc));
check('65 点击走同一套写入函数（确认 + 快照 + 可撤销）', /cc-var-table[\s\S]{0,700}applyTableWrite\(tg\.id\)/.test(sbSrc));
check('65 关掉开关后按钮不再显示', sbSrc.indexOf("settings().tableWrite === false") > 0);
check('65 按钮文案中英各一', (sbSrc.split("varTableBtn: '").length - 1) === 2);
const sbCss = readFileSync(new URL('../extensions/card-compat/style.css', import.meta.url), 'utf8');
check('65 配色限定在 #cc-var-bar 内（不污染消息区）', (sbCss.split('.ccv-table').length - 1) === (sbCss.split('#cc-var-bar .ccv-btn.ccv-table').length - 1));

console.log('');
console.log('— 夹具 66：从 swipe 恢复被误删的块（0.25.0）');
const rsSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('66 有硬判据：清理 swipe 原文后正好等于 mes', rsSrc.indexOf('function strippedFromSwipe') > 0 && /String\(r\.text\)\.trim\(\) === cur\.trim\(\)/.test(rsSrc));
check('66 恢复走确认框', /function restoreFromSwipe[\s\S]{0,1200}callGenericPopup/.test(rsSrc));
check('66 恢复进撤销栈且 kind=text', /restoreFromSwipe[\s\S]{0,1200}kind: 'text'/.test(rsSrc));
check('66 撤销认得文本恢复', /function undoMoneyFix[\s\S]{0,500}last\.kind === 'text'/.test(rsSrc));
check('66 发送栏第三个按钮就位', rsSrc.indexOf("cc-var-restore") > 0);
check('66 按钮默认隐藏且无命中不显示', rsSrc.indexOf("br.style.display") > 0 && rsSrc.indexOf("function restoreTarget") > 0);
check('66 恢复文案中英各一', rsSrc.split("restoreBtn: '").length - 1 === 2);
const rsCss = readFileSync(new URL('../extensions/card-compat/style.css', import.meta.url), 'utf8');
check('66 恢复按钮配色限定在 #cc-var-bar 内', (rsCss.split('.ccv-restore').length - 1) === (rsCss.split('#cc-var-bar .ccv-btn.ccv-restore').length - 1));
const junk = '正文' + String.fromCharCode(10) + '<tiny_junk>短</tiny_junk>';
const junkCleaned = stripUndeclaredBlocks(junk, { declared: [], keep: KEEP_BLOCKS });
check('66 小块会被砍（判据在这种情况下成立）', junkCleaned.removed.length === 1 && junkCleaned.text.trim() !== junk.trim());
const bigBody = new Array(1300).join('y');
const bigRaw = '正文' + String.fromCharCode(10) + '<huge2>' + bigBody + '</huge2>';
const bigCleaned = stripUndeclaredBlocks(bigRaw, { declared: [], keep: KEEP_BLOCKS });
check('66 超大块被安全阀保住 → 不会被误判成「被砍过」', bigCleaned.removed.length === 0 && bigCleaned.text.trim() === bigRaw.trim());

console.log('');
console.log('— 夹具 67：非 YAML 块不参与 YAML 校验/修复（0.25.1，连楼误报的根因）');
const f67Yaml = { load: () => { throw new Error('不该被调用'); } };
const f67Uv = '<UpdateVariable>' + String.fromCharCode(10) + '<Analysis>a</Analysis>' + String.fromCharCode(10) + '<JSONPatch>[{"op":"replace","path":"/a","value":1}]</JSONPatch>' + String.fromCharCode(10) + '</UpdateVariable>';
check('67 <UpdateVariable> 不再被当 YAML 校验（不会连楼报警）', strictYamlCheck(f67Uv, ['UpdateVariable'], f67Yaml).blocks === 0);
check('67 YAML 修复也不碰它（原来会改写 JSONPatch）', guardBlockYaml(f67Uv, ['UpdateVariable'], {}).text === f67Uv && repairYamlStructure(f67Uv, ['UpdateVariable']).text === f67Uv);
const f67St = '<status_current_variables>' + String.fromCharCode(10) + 'a: 1' + String.fromCharCode(10) + '</status_current_variables>';
check('67 状态表同样不参与 YAML 校验', strictYamlCheck(f67St, ['status_current_variables'], f67Yaml).blocks === 0);
check('67 真正的 YAML 块仍然被校验（功能没被削弱）', strictYamlCheck('<st_data>' + String.fromCharCode(10) + 'a: 1' + String.fromCharCode(10) + '</st_data>', ['st_data'], f67Yaml).issues.length === 1);
check('67 判定表正确', isNonYamlTag('UpdateVariable') === true && isNonYamlTag('JSONPatch') === true && isNonYamlTag('st_data') === false);
const f67Src = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('67 面板侧改用过滤后的标签列表', f67Src.indexOf('function yamlTagsOf') > 0 && (f67Src.split('yamlTagsOf(').length - 1) >= 4);

console.log('');
console.log('— 夹具 68：渲染体检（0.26.0，只靠文件看不出的运行时判定）');
const hSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('68 有 renderHealth 且逐条对照 ST 的判定条件', hSrc.indexOf('function renderHealth') > 0 && hSrc.indexOf('character_allowed_regex') > 0);
check('68 检查 1：正则扩展是否被禁用', hSrc.indexOf('disabledExtensions') > 0 && hSrc.indexOf('正则扩展被禁用') > 0);
check('68 检查 4：avatar 与允许列表全等比较（大小写/归一化差异会被抓出来）', /allow\.indexOf\(avatar\)/.test(hSrc));
check('68 会列出「名字相近的条目」便于肉眼比对', hSrc.indexOf('名字相近的条目') > 0);
check('68 读 DOM 判断锚点是否裸露（区分「渲染器没跑正则」）', hSrc.indexOf('mes_text') > 0 && hSrc.indexOf('裸露锚点') > 0);
check('68 发送栏有体检按钮且结果会复制 + 记日志', hSrc.indexOf('cc-var-health') > 0 && hSrc.indexOf('render-health') > 0 && hSrc.indexOf('navigator.clipboard') > 0);
check("68 体检文案中英各一", hSrc.split("healthBtn: '").length - 1 === 2);
const hCss = readFileSync(new URL('../extensions/card-compat/style.css', import.meta.url), 'utf8');
check('68 体检按钮配色限定 #cc-var-bar 内', (hCss.split('.ccv-health').length - 1) === (hCss.split('#cc-var-bar .ccv-btn.ccv-health').length - 1));

console.log('');
console.log('— 夹具 69：MVU 判定按真实键名（0.26.1，「补丁不完整」的判定依据）');
const mvSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('69 读真实键「更新方式」', mvSrc.indexOf('pool[\u0027更新方式\u0027]') > 0 || mvSrc.indexOf("pool[" + String.fromCharCode(39) + "更新方式" + String.fromCharCode(39) + "]") > 0);
check('69 读真实键「启用自动请求」', mvSrc.indexOf('启用自动请求') > 0);
check("69 模式含「额外模型解析」才进入该分支", mvSrc.indexOf("额外模型解析") > 0 && mvSrc.indexOf("mode.indexOf") > 0);
check('69 自动请求关着时**不让位**（否则没人补数据）', /if \(auto === false\) return false;/.test(mvSrc));
check('69 记下 mode/auto 供体检用', mvSrc.indexOf('mvuExtraInfo = { mode: mode, auto: auto }') > 0);
check('69 体检报告含 MVU 判定与成因说明', mvSrc.indexOf('更新方式=') > 0 && mvSrc.indexOf('额外解析不会自动跑') > 0);

console.log('');
console.log('— 夹具 70：版本自证 + 旧版删除行为可复现（0.26.2）');
const vsSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('70 体检报告第一行报扩展版本', /out\.push\(.0\) 本扩展版本: v. \+ VERSION/.test(vsSrc));
check('70 启动日志带版本号（用于确认加载到哪一版）', /log\(.boot., .v. \+ VERSION/.test(vsSrc));
// 用真实形态验证：当前白名单不删表，去掉白名单里的表族才会删（旧版行为可复现）
const f70Table = '<status_current_variables>' + String.fromCharCode(10) + '系统:' + String.fromCharCode(10) + '  时间: 14:15' + String.fromCharCode(10) + '林婉婷:' + String.fromCharCode(10) + '  穿搭: 黑色皮衣' + String.fromCharCode(10) + '  心情: 期待' + String.fromCharCode(10) + '</status_current_variables>';
const f70Decl = new Set(['UpdateVariable', 'StatusPlaceHolderImpl']);
const f70a = stripUndeclaredBlocks(f70Table, { declared: f70Decl, keep: KEEP_BLOCKS });
check('70 当前白名单：状态表一个字都不删', f70a.removed.length === 0 && f70a.text.indexOf('<status_current_variables>') >= 0);
const f70Old = new Set([...KEEP_BLOCKS].filter((x) => x.indexOf('status') !== 0 && x !== '变量表' && x !== '状态表' && x !== '变量列表' && x !== '状态栏'));
const f70b = stripUndeclaredBlocks(f70Table, { declared: f70Decl, keep: f70Old });
check('70 去掉表族白名单后复现旧版删除（= 用户看到的现象）', f70b.removed.length === 1 && f70b.removed[0].tag === 'status_current_variables');

console.log('');
console.log('— 夹具 71：收支保护逐条把关（0.27.0，用户实测回归的修复）');
const g71st = { 林婉婷: { 经济: { 现金: 500, 欠款: 3000 } }, user: { 累计支出_林婉婷: 0 }, 互动次数: { 林婉婷与user: 0 } };
const g71ops = [
    { op: 'delta', path: '/林婉婷/经济/现金', value: -2500 },
    { op: 'delta', path: '/user/累计支出_林婉婷', value: 2500 },
    { op: 'delta', path: '/互动次数/林婉婷与user', value: 1 },
];
const g71a = applyVarOps(g71st, g71ops, {});
check('71 逐条把关：对的 delta 照常落地（支出 2500 / 互动 1）', g71a.state.user['累计支出_林婉婷'] === 2500 && g71a.state['互动次数']['林婉婷与user'] === 1, g71a.state);
check('71 只跳过会变负的那一条（现金保持 500）', g71a.state['林婉婷']['经济']['现金'] === 500 && g71a.skipped.some((x) => x.path === '/林婉婷/经济/现金'));
check('71 guardHit 记录被跳过的那条（面板要显示）', Array.isArray(g71a.guardHit) && g71a.guardHit.length === 1);
const g71f = applyVarOps(g71st, g71ops, { overdraftMode: 'floor' });
check('71 旧行为可复现（整楼丢弃 → 钱完全不更新）', g71f.state.user['累计支出_林婉婷'] === 0 && g71f.state['互动次数']['林婉婷与user'] === 0);
const g71o = applyVarOps(g71st, g71ops, { overdraftGuard: false });
check('71 关掉保护时余额会变负（说明保护仍有意义）', g71o.state['林婉婷']['经济']['现金'] === -2000);
const g71b = applyVarOps(g71st, [{ op: 'delta', path: '/user/累计支出_林婉婷', value: 300 }], {});
check('71 没有变负风险时全部照常、零跳过', g71b.state.user['累计支出_林婉婷'] === 300 && g71b.skipped.length === 0);

console.log('');
console.log('— 夹具 72：模型从没写过的字段提醒（0.28.0，实测「穿搭一直停在初值」）');
const nwSrc = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('72 有 neverWrittenFields（对照卡片 required 与最近楼层的补丁路径）', nwSrc.indexOf('function neverWrittenFields') > 0 && nwSrc.indexOf('opsForMessage(m.mes)') > 0);
check('72 用的是归一化后的路径比较（点号/斜杠/模板包裹都能对上）', /function neverWrittenFields[\s\S]{0,900}normalizePath\(op && op\.path\)/.test(nwSrc));
check('72 面板会显示（含字段名列表）', nwSrc.indexOf("T('neverWritten'") > 0 && nwSrc.indexOf('模型至今没写过') > 0);
check('72 文案中英各一', nwSrc.split("neverWritten: '").length - 1 === 2);
check('72 提醒里写明「插件不会替你编造」（与 0.3.3 一致）', nwSrc.indexOf('插件不会替你编造') > 0);

console.log('');
console.log('— 夹具 73：提醒必须带上「从没写过」的字段（0.29.0，实测 穿搭 被上限挤掉）');
const f73fields = [];
for (let i = 0; i < 20; i++) f73fields.push({ path: '林婉婷.字段' + i });
f73fields.push({ path: '林婉婷.穿搭' });
const f73old = pickReminderFields(f73fields, 14);
check('73 复现：14 条上限内轮询会把末尾的 穿搭 挤掉', f73old.length === 14 && !f73old.some((x) => x.path.indexOf('穿搭') >= 0), f73old.map((x) => x.path));
const f73new = pickReminderFields(f73fields, 14, { mustInclude: ['/林婉婷/穿搭'] });
check('73 修复：加 mustInclude 后 穿搭 一定进提醒（且排在最前）', f73new.some((x) => x.path === '林婉婷.穿搭') && f73new[0].path === '林婉婷.穿搭', f73new.map((x) => x.path));
check('73 上限仍然被尊重（没有把提醒撑爆）', f73new.length <= 14);
check('73 字段数没超上限时行为不变（向后兼容）', pickReminderFields([{ path: 'a.b' }, { path: 'c.d' }], 14).length === 2);
check('73 mustInclude 用归一化比较（/a/b 与 a.b 等价）', pickReminderFields([{ path: '林婉婷.穿搭' }, { path: 'x.y' }], 14, { mustInclude: ['/林婉婷/穿搭'] }).some((x) => x.path === '林婉婷.穿搭'));
const f73src = readFileSync(new URL('../extensions/card-compat/index.js', import.meta.url), 'utf8');
check('73 面板侧把「从没写过」的字段喂进提醒', /neverWrittenFields\(12\)[\s\S]{0,300}mustInclude: neverW/.test(f73src));
check('73 有日志说明哪些字段被优先', f73src.indexOf("log('reminder-priority'") > 0);

console.log('结果: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
