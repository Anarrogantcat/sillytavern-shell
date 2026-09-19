// scripts/plot-pilot-test.mjs — 剧情推进器 Plot Pilot 夹具测试
// 用法：node scripts/plot-pilot-test.mjs [--no-real]
//   默认会顺带扫一遍本机角色卡目录，打印真实探测分布（不联网、只读）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
    DEFAULTS, detectBlueprint, formatDetection, buildAdvanceText, resolveCard,
    shouldShowAdvance, sanitizeConfig, legacyStandby, detectLegacySignals,
    pickSendStrategy, summarizeState, advancePayload,
} from '../extensions/plot-pilot/logic.js';

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    failures.push(name + (extra !== undefined ? ('  → ' + JSON.stringify(extra)) : ''));
}
function eq(name, actual, expected) { ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected }); }

/* ---------------------------- 探测 ---------------------------- */
const detKey = detectBlueprint({ keys: ['blueprint_controller'], text: '' });
eq('强信号·扩展键名命中', [detKey.has, detKey.confidence, detKey.varName], [true, 'strong', 'blueprint_controller']);
const detText = detectBlueprint({ text: '本卡使用 blueprint 变量管理剧情' });
eq('强信号·正文命中', [detText.has, detText.confidence, detText.varName], [true, 'strong', 'blueprint']);
const detCn = detectBlueprint({ text: '请读取 剧本控制器 的当前状态' });
eq('强信号·中文变量名', [detCn.confidence, detCn.varName], ['strong', '剧本控制器']);
const detStep = detectBlueprint({ text: '请根据当前状态推进至下一个 step 继续' });
eq('弱信号·推进 step', [detStep.has, detStep.confidence, detStep.varName], [true, 'weak', null]);
const detWeak = detectBlueprint({ text: '本卡是一份剧本，包含剧情节点' });
eq('弱信号·泛词', [detWeak.confidence, detWeak.hits.length > 0], ['weak', true]);
const detNone = detectBlueprint({ text: '' });
eq('无信号·空文本', [detNone.has, detNone.confidence, detNone.hits.length], [false, 'none', 0]);
const detNone2 = detectBlueprint({ text: '这是一张普通的日常向角色卡，没有额外系统。' });
eq('无信号·普通卡', [detNone2.has, detNone2.confidence], [false, 'none']);
eq('探测结果可读文本·无', formatDetection(detNone).indexOf('无剧本系统') === 0, true);
eq('探测结果可读文本·强', formatDetection(detKey).indexOf('blueprint_controller') > 0, true);
eq('探测结果可读文本·弱', formatDetection(detWeak).indexOf('弱信号') > 0, true);

/* ---------------------------- 文案 ---------------------------- */
eq('推进文案·替换变量名', buildAdvanceText(DEFAULTS, detKey), '请根据当前 blueprint_controller，推进至下一个 step');
eq('推进文案·无变量名回落', buildAdvanceText(DEFAULTS, detWeak), '请根据当前 剧情蓝图，推进至下一个 step');
eq('推进文案·模板无占位符', buildAdvanceText({ advanceText: '继续推进' }, detKey), '继续推进');
eq('推进文案·空配置回落默认', buildAdvanceText({}, detKey).indexOf('blueprint_controller') > 0, true);

eq('推进内容·强信号用真实变量名', advancePayload(DEFAULTS, detKey), '请根据当前 blueprint_controller，推进至下一个 step');
eq('推进内容·弱信号写「剧情蓝图」', advancePayload(DEFAULTS, detWeak), '请根据当前 剧情蓝图，推进至下一个 step');
eq('推进内容·无信号走兜底文案', advancePayload(DEFAULTS, detNone), DEFAULTS.advanceTextFallback);

/* ---------------------------- 每卡覆盖 ---------------------------- */
const cfg = sanitizeConfig({ continueText: '全局续写', cards: { '卡A': { showContinue: false, continueText: '本卡续写' } } });
const effA = resolveCard(cfg, '卡A');
const effB = resolveCard(cfg, '卡B');
eq('每卡覆盖·生效', [effA.showContinue, effA.continueText], [false, '本卡续写']);
eq('每卡覆盖·不串卡', [effB.showContinue, effB.continueText], [undefined, '全局续写']);
eq('每卡覆盖·带卡名', effA.cardName, '卡A');

/* ---------------------------- 显示判定 ---------------------------- */
eq('显示推进·强信号', shouldShowAdvance(sanitizeConfig({}), detKey), true);
eq('显示推进·弱信号默认显示（沿用旧行为）', shouldShowAdvance(sanitizeConfig({}), detWeak), true);
eq('显示推进·弱信号可关掉', shouldShowAdvance(sanitizeConfig({ showAdvanceWhenUnknown: false }), detWeak), false);
const cfgHide = sanitizeConfig({ cards: { '卡C': { showAdvance: false } } });
eq('显示推进·本卡隐藏优先', shouldShowAdvance(resolveCard(cfgHide, '卡C'), detKey), false);
eq('显示推进·本卡强制显示(弱信号)', shouldShowAdvance(resolveCard(sanitizeConfig({ cards: { '卡D': { showAdvance: true } } }), '卡D'), detWeak), true);
eq('显示推进·无探测', shouldShowAdvance(sanitizeConfig({ showAdvanceWhenUnknown: true }), detNone), false);

/* ---------------------------- 配置清洗 ---------------------------- */
const dirty = sanitizeConfig({
    enabled: 'no', showBar: false, clickGuardMs: 99999, pollMs: 5, waitSendableMs: -1,
    sendMode: 'bogus', continueText: 12345, logLimit: 9999,
    cards: { '卡A': { showAdvance: true, junk: 1 }, '卡B': 'not-an-object' }, custom_future_key: 'keep-me',
});
eq('清洗·坏布尔回落默认', dirty.enabled, true);
eq('清洗·正常布尔保留', dirty.showBar, false);
eq('清洗·夹取上限', dirty.clickGuardMs, 10000);
eq('清洗·夹取下限', [dirty.pollMs, dirty.waitSendableMs], [100, 0]);
eq('清洗·非法枚举回落', dirty.sendMode, 'auto');
eq('清洗·坏字符串回落默认', dirty.continueText, DEFAULTS.continueText);
eq('清洗·日志上限夹取', dirty.logLimit, 500);
eq('清洗·每卡非法项剔除', [dirty.cards['卡A'].showAdvance, 'junk' in dirty.cards['卡A'], '卡B' in dirty.cards], [true, false, false]);
eq('清洗·保留未知字段（向前兼容）', dirty.custom_future_key, 'keep-me');

/* ---------------------------- 旧脚本冲突 ---------------------------- */
eq('冲突·有旧脚本则待命', legacyStandby(sanitizeConfig({}), true).standby, true);
eq('冲突·忽略开关可放行', legacyStandby(sanitizeConfig({ ignoreLegacy: true }), true).standby, false);
eq('冲突·无旧脚本不待命', legacyStandby(sanitizeConfig({}), false).standby, false);
eq('冲突·信号判定', [detectLegacySignals({ hasGlobals: true }), detectLegacySignals({ hasBarElement: true }), detectLegacySignals({})], [true, true, false]);

/* ---------------------------- 发送通道 ---------------------------- */
eq('通道·自动优先 api', pickSendStrategy('auto', { api: true, dom: true }), 'api');
eq('通道·自动无 api 走 dom', pickSendStrategy('auto', { dom: true }), 'dom');
eq('通道·强制 api 但不可用时回落', pickSendStrategy('api', { dom: true }), 'dom');
eq('通道·强制 dom', pickSendStrategy('dom', { api: true, dom: true }), 'dom');

/* ---------------------------- 状态汇总 ---------------------------- */
const sum = summarizeState({ det: detKey, cardName: '卡A', enabled: true, strategy: 'api' });
ok('汇总·含卡名与状态', sum.indexOf('卡A') > 0 && sum.indexOf('工作中') > 0, sum);
const sum2 = summarizeState({ det: detNone, cardName: '卡B', enabled: true, standby: true, strategy: 'dom' });
ok('汇总·待命提示', sum2.indexOf('待命') > 0, sum2);

/* ---------------------------- 真实角色卡扫描 ---------------------------- */
function readCards(dir) {
    if (!fs.existsSync(dir)) return null;
    const out = [];
    for (const f of fs.readdirSync(dir)) {
        if (!/\.png$/i.test(f)) continue;
        const buf = fs.readFileSync(path.join(dir, f));
        if (buf.slice(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') continue;
        let off = 8; const texts = {};
        while (off + 8 <= buf.length) {
            const len = buf.readUInt32BE(off);
            const type = buf.slice(off + 4, off + 8).toString('latin1');
            const data = buf.slice(off + 8, off + 8 + len);
            if (type === 'tEXt') { const z = data.indexOf(0); texts[data.slice(0, z).toString('latin1')] = data.slice(z + 1).toString('latin1'); }
            else if (type === 'zTXt') { const z = data.indexOf(0); try { texts[data.slice(0, z).toString('latin1')] = zlib.inflateSync(data.slice(z + 2)).toString('latin1'); } catch (_) {} }
            off += 12 + len;
            if (type === 'IEND') break;
        }
        if (!texts.chara) continue;
        try { out.push({ file: f, card: JSON.parse(Buffer.from(texts.chara, 'base64').toString('utf8')) }); } catch (_) {}
    }
    return out;
}

function profileOf(card) {
    const d = card.data || card;
    const parts = [];
    const keys = [];
    for (const k of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions']) parts.push(String(d[k] || ''));
    const ext = d.extensions || {};
    keys.push.apply(keys, Object.keys(ext));
    const th = ext.tavern_helper;
    if (th && th.variables) keys.push.apply(keys, Object.keys(th.variables));
    if (th && Array.isArray(th.scripts)) for (const s of th.scripts) { keys.push(String(s.name || '')); parts.push(String(s.content || '')); }
    parts.push(JSON.stringify(ext));
    for (const e of ((d.character_book && d.character_book.entries) || [])) { parts.push(String(e.comment || '')); parts.push(String(e.content || '')); }
    return { text: parts.join('\n'), keys };
}

const realDir = process.env.PLOTPILOT_CARDS || 'D:/AI/SillyTavern/Data/default-user/characters';
if (!process.argv.includes('--no-real')) {
    const cards = readCards(realDir);
    if (cards) {
        let strong = 0, weak = 0, none = 0, shown = 0;
        const strongNames = [], weakNames = [];
        const cfgDefault = sanitizeConfig({});
        for (const c of cards) {
            const det = detectBlueprint(profileOf(c.card));
            if (shouldShowAdvance(cfgDefault, det)) shown++;
            if (det.confidence === 'strong') { strong++; strongNames.push(c.file.replace(/\.png$/, '') + '(' + det.varName + ')'); }
            else if (det.confidence === 'weak') { weak++; weakNames.push(c.file.replace(/\.png$/, '')); }
            else none++;
        }
        console.log('真实角色卡扫描（' + cards.length + ' 张，来源 ' + realDir + '）：');
        console.log('  强信号 ' + strong + ' 张 → 推进按钮带真实变量名');
        console.log('  弱信号 ' + weak + ' 张 → 推进按钮用「剧情蓝图」措辞（可在面板关掉）');
        console.log('  无信号 ' + none + ' 张 → 只显示「续写」');
        console.log('  按默认配置：' + shown + ' 张显示推进按钮，' + (cards.length - shown) + ' 张只显示「续写」');
        if (process.argv.includes('--verbose')) {
            console.log('  强信号卡：' + strongNames.join('、'));
            console.log('  弱信号卡：' + weakNames.join('、'));
        }
        ok('真实卡扫描·至少一张强信号卡', strong >= 1, { strong, weak, none });
    } else {
        console.log('真实角色卡扫描：跳过（未找到 ' + realDir + '）');
    }
}

console.log('');
if (failures.length) {
    console.log('夹具结果：' + pass + ' 项通过，' + failures.length + ' 项失败');
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
} else {
    console.log('夹具结果：' + pass + '/' + pass + ' 全部通过');
}
