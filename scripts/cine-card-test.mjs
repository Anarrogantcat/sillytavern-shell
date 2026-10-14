// scripts/cine-card-test.mjs —— 角色卡端到端测试（用真实角色卡 + 真实聊天记录）
//
// 之前的"测试"问题：一直只用合成字符串 + 只测渲染函数，**从没按角色卡维度测过** ✗
// 本脚本按卡维度做三件事（全部只读）：
//   ① 解析每张卡（PNG tEXt → base64 → JSON）：世界书 / 首条 / 前端标签 / TavernHelper
//   ② 找到这张卡的聊天记录（chats/<卡名>/），抽模型消息，跑我们的渲染器
//   ③ 断言：卡的前端标签**原样保留** ✓ · 我们该接手的接手了 ✓ · 标签零裸露 ✓
// 用法：node scripts/cine-card-test.mjs [--limit N]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(__dirname, '..');
const CH = 'D:/AI/SillyTavern/Data/default-user/characters';
const CHATS = 'D:/AI/SillyTavern/Data/default-user/chats';
const m = await import('file:///' + path.join(R, 'extensions/cine-dialogue/logic.js').replace(/\\/g, '/') + '?' + Date.now());

const args = process.argv.slice(2);
const LIMIT = Number((args.indexOf('--limit') >= 0 ? args[args.indexOf('--limit') + 1] : 0)) || 0;

function parseCard(buf) {
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8; const texts = [];
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'tEXt' || type === 'iTXt') {
            const s = data.toString('utf8');
            const mm = s.match(/(chara|ccv3)\u0000([\s\S]*)$/);
            if (mm && mm[2]) { try { texts.push(JSON.parse(Buffer.from(mm[2], 'base64').toString('utf8'))); } catch { } }
        }
        off += 12 + len;
        if (type === 'IEND') break;
    }
    return texts.length ? texts.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0] : null;
}
const MARKS = ['StatusPlaceHolderImpl', '<option', '<StatusBar>', 'UpdateVariable', 'TavernHelper', 'stat_data', 'getVariables', '<%'];
/* ★ 两类标签要分开对待（2026-10-14 修正：我第一版把它们混在一起 ⇒ 误报 8 条 ✗）：
   ① **必须原样保留**：卡的状态栏 / 变量 / TavernHelper 那类 —— 丢了界面就画不出来 ✗
   ② **允许被我们替换**：`<options>` 家族 —— 我们有自己的选项 UI（cd-opt）✓
      但要断言：替换后**选项文字仍然可见** ✓（否则就是真丢 ✗） */
const KEEP_MARKS = ['StatusPlaceHolderImpl', '<StatusBar>', 'UpdateVariable', 'TavernHelper', 'stat_data', 'getVariables', '<%'];
const OPT_MARKS = ['<option', '[OPTIONS]'];
const countMarks = (s) => MARKS.map((k) => [k, (String(s).match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length]).filter(([, c]) => c);
const countOf = (s, k) => (String(s == null ? '' : s).split(k).length - 1);

const cards = fs.readdirSync(CH).filter((f) => f.endsWith('.png'));
const rows = [];
let nCard = 0, nParsed = 0, nWithBook = 0, nWithFE = 0, nChatMatched = 0;
let tagLost = 0, leak = 0, crash = 0, notTaken = 0, msgs = 0;
let optLost = 0, shrink = 0, respectBad = 0, respectPass = 0;
const problems = [];
const optEx = [], shrinkEx = [], respectEx = [];

for (const f of cards) {
    nCard++;
    if (LIMIT && nCard > LIMIT) break;
    let j = null; try { j = parseCard(fs.readFileSync(CH + '/' + f)); } catch { }
    if (!j) continue;
    nParsed++;
    const d = j.data || j;
    const name = String(d.name || f.replace('.png', ''));
    const book = d.character_book && Array.isArray(d.character_book.entries) ? d.character_book.entries.length : 0;
    if (book) nWithBook++;
    const firstMes = String(d.first_mes || '');
    const marks = countMarks(JSON.stringify(d));
    if (marks.length) nWithFE++;

    /* 找这张卡的聊天目录（chats/<卡名>/） */
    const dir = path.join(CHATS, name);
    let chatFiles = [];
    try { chatFiles = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).map((x) => path.join(dir, x)); } catch { }
    if (!chatFiles.length) { rows.push({ name, book, marks: marks.length, msgs: 0, note: '没有聊天记录' }); continue; }
    nChatMatched++;

    /* 逐条模型消息：渲染 + 三条断言 */
    let localLost = 0, localLeak = 0, localCrash = 0, localNot = 0, localMsgs = 0, localOpt = 0, localShrink = 0;
    for (const cf of chatFiles) {
        for (const ln of fs.readFileSync(cf, 'utf8').split('\n')) {
            if (!ln.trim()) continue;
            let o; try { o = JSON.parse(ln); } catch { continue; }
            if (o.is_user || !o.mes) continue;
            const mes = String(o.mes);
            localMsgs++; msgs++;
            let r = null;
            try { r = m.renderMessageHTML(mes, {}, m.DEFAULT_CONFIG); } catch { localCrash++; crash++; continue; }
            if (!r) { if (/·(动作|感官|台词|心理|旁白)/.test(mes)) { localNot++; notTaken++; } continue; }
            const html = String(r.html);
            /* ① 必须原样保留的标签（卡的状态栏 / 变量 / TavernHelper） */
            for (const k of KEEP_MARKS) {
                if (countOf(mes, k) > countOf(html, k)) { localLost++; tagLost++; break; }
            }
            /* ② <options> 家族：允许被替换，但**选项文字必须仍可见** ✓ */
            if (OPT_MARKS.some((k) => countOf(mes, k) > 0)) {
                const blk = (mes.match(/<options>([\s\S]*?)<\/options>/i) || [])[1] || '';
                const lines = blk.split('\n').map((x) => x.trim()).filter((x) => x && !/^<\/?options>$/i.test(x));
                const visOpt = String(r.html).replace(/<[^>]*>/g, '');
                const gone = lines.filter((l) => {
                    /* 去掉行首的编号/引用符号**以及**「选项一：」这类中文编号前缀，再取样 */
                    const key = l.replace(/^[>\d.、)）\s]+/, '').replace(/^选项[一二三四五六七八九十0-9]+[:：]?/, '').trim().slice(0, 8);
                    return key && visOpt.indexOf(key) < 0;
                });
                if (gone.length) {
                    localOpt++; optLost++;
                    if (optEx.length < 3) optEx.push({ name, line: gone[0].slice(0, 40) });
                }
            }
            /* ③ 守恒：可见文字不该塌陷（防止再来一次"静默丢字"） */
            const visAll = String(r.html).replace(/<[^>]*>/g, '').replace(/\s+/g, '');
            const srcAll = mes.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
            if (srcAll.length > 200 && visAll.length < srcAll.length * 0.7) {
                localShrink++;
                if (shrinkEx.length < 3) shrinkEx.push({ name, src: srcAll.length, vis: visAll.length });
            }
            const vis2 = html.replace(/<[^>]*>/g, '');
            if (/[^\s]{1,10}(·|・)(动作|感官|台词|心理|旁白)/.test(vis2)) { localLeak++; leak++; }
            /* ④ ★ 1.7.0：卡自带前端时，我们**不该**再画自己的选项栏，且 `<options>` 要原样保留 ✓ */
            if (marks.length) {
                let r2 = null;
                try { r2 = m.renderMessageHTML(mes, {}, { ...m.DEFAULT_CONFIG, cardHasFrontend: true }); } catch { }
                /* ★ r2 === null ⇒ 我们**根本没接手**（原样放行给卡的渲染器 ✓）
                   —— 这是**最彻底的不干扰** ✓ 不是违规 ✗（我第一版把它当违规 ⇒ 误报 ✗） */
                if (r2) {
                    const h2 = String(r2.html);
                    const ourOpts = (h2.match(/class="cd-opt[ "]/g) || []).length;
                    const rawOpts = /<options>/i.test(mes) ? (h2.indexOf('<options>') >= 0) : true;
                    if (ourOpts > 0 || !rawOpts) {
                        respectBad++;
                        if (respectEx.length < 3) respectEx.push({ name, ourOpts, rawOpts });
                    }
                } else respectPass++;
            }
        }
    }
    rows.push({ name, book, marks: marks.length, msgs: localMsgs, lost: localLost, leak: localLeak, crash: localCrash, not: localNot, opt: localOpt, shrink: localShrink });
    if (localLost || localLeak || localCrash || localNot || localOpt || localShrink) {
        problems.push({ name, lost: localLost, leak: localLeak, crash: localCrash, not: localNot, opt: localOpt, shrink: localShrink });
    }
}

/* ===== 输出 ===== */
console.log('=== 角色卡端到端测试（真实卡 + 真实聊天） ===');
console.log('  角色卡 ' + nCard + ' 张 · 解析成功 ' + nParsed + ' · 自带世界书 ' + nWithBook + ' · 含前端标签 ' + nWithFE);
console.log('  有聊天记录的卡 ' + nChatMatched + ' 张 · 检查过的模型消息 ' + msgs + ' 条');
console.log('');
console.log('  断言：');
console.log('   ' + (tagLost ? 'FAIL' : 'OK  ') + ' ① 卡前端标签原样保留（状态栏/变量/TavernHelper）：丢失 ' + tagLost + ' 条消息');
console.log('   ' + (optLost ? 'FAIL' : 'OK  ') + ' ② <options> 被替换后**选项文字仍可见**：丢失 ' + optLost + ' 条');
console.log('   ' + (shrink ? 'FAIL' : 'OK  ') + ' ③ 可见文字不塌陷（守恒 ≥70%）：塌陷 ' + shrink + ' 条');
console.log('   ' + (leak ? 'FAIL' : 'OK  ') + ' ④ 标签零裸露：裸露 ' + leak + ' 条');
console.log('   ' + (crash ? 'FAIL' : 'OK  ') + ' ⑤ 渲染不崩溃：崩溃 ' + crash + ' 条');
console.log('   ' + (notTaken ? 'FAIL' : 'OK  ') + ' ⑥ 该接手的都接手：未接手 ' + notTaken + ' 条');
console.log('   ' + (respectBad ? 'FAIL' : 'OK  ') + ' ⑦ 卡有前端时不抢它的选项栏：违规 ' + respectBad + ' 条（另有 ' + respectPass + ' 条我们原样放行 ✓）');
if (respectEx.length) { console.log('  ⑦ 违规例子：'); respectEx.forEach((x) => console.log('   · ' + x.name.slice(0, 20) + '  我们画了 ' + x.ourOpts + ' 个按钮 · <options> 保留=' + x.rawOpts)); }
console.log('');
if (optEx.length) { console.log('  选项文字丢失的例子：'); optEx.forEach((x) => console.log('   · ' + x.name.slice(0, 20) + '  ' + JSON.stringify(x.line))); }
if (shrinkEx.length) { console.log('  文字塌陷的例子：'); shrinkEx.forEach((x) => console.log('   · ' + x.name.slice(0, 20) + '  原文 ' + x.src + ' → 可见 ' + x.vis)); }
console.log('');
if (problems.length) {
    console.log('  有问题的卡：');
    problems.slice(0, 12).forEach((p) => console.log('   · ' + p.name.slice(0, 24) + '  标签 ' + p.lost + ' / 选项 ' + p.opt + ' / 塌陷 ' + p.shrink + ' / 裸露 ' + p.leak + ' / 崩溃 ' + p.crash + ' / 未接手 ' + p.not));
} else console.log('  有问题的卡：无 ✓');
console.log('');
console.log('  按卡明细（前 18 张）：');
rows.slice(0, 18).forEach((x) => {
    const n = ['世界书 ' + x.book, '前端标签 ' + (x.marks || 0), '消息 ' + (x.msgs || 0)];
    const bad = (x.lost || x.leak || x.crash || x.not || x.opt || x.shrink) ? '   ★ 有问题' : '';
    console.log('   · ' + String(x.name).slice(0, 22).padEnd(23) + n.join(' · ') + (x.note ? '  ' + x.note : '') + bad);
});
console.log('');
console.log('=== 结论口径 ===');
console.log('  · ①类标签（占位符 / TavernHelper / MVU）**必须原样保留** —— 否则状态栏会画不出来');
console.log('  · ②类 `<options>` 我们有自己的选项 UI ⇒ 允许替换，但**文字必须还在**');
console.log('  · ③守恒检查 = 防止再出现"静默丢字"（本轮就是这么抓到 splitSections 疑点的）');
console.log('  · 本题**与用哪份预设无关**：卡自带的支撑跟着卡走 ✓');
process.exit((tagLost || leak || crash || notTaken || optLost || shrink || respectBad) ? 1 : 0);
