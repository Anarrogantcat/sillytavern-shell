// scripts/compat-logic-test.mjs — card-compat 逻辑层夹具断言（不依赖 ST/Electron）
import { buildProfile, guardText, findUnclosed, freshnessFields, isStale, normalizeMalformedClosings, detectForeignTags } from '../extensions/card-compat/logic.js';

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

console.log('');
console.log('结果: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
