// scripts/compat-logic-test.mjs — card-compat 逻辑层夹具断言（不依赖 ST/Electron）
import { buildProfile, guardText, findUnclosed, freshnessFields, isStale, normalizeMalformedClosings, detectForeignTags, buildTailReminder, dedupeSelfClosingAnchors, extractVarSpec, extractRequiredFields, patchCoverage, repairSmartQuotes, guardBlockYaml } from '../extensions/card-compat/logic.js';

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

console.log('');
console.log('结果: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
