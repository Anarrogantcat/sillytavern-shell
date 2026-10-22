// scripts/cine-full-test.mjs —— 分镜对话 扩展 · 完整测试（一个入口）
//
// 覆盖：
//   A 版本三处一致        B 语法                C 夹具
//   D 生成器行为（幂等 / --merge-from 增量与去重 / --check 不写文件）
//   E 两份预设的不变量（垃圾 / 铁律位置 / 字数指令改写 / 条目启用）
//   F 预设与代码同步（格式条目必须逐字节一致；篇幅条目"盖章在则一致"）
//   G 真机渲染（全部聊天：崩溃 / 未接手 / 标签裸露）
//   H 清单 + 部署一致性
//
// 用法：node scripts/cine-full-test.mjs          （只读，不改任何东西）
//       node scripts/cine-full-test.mjs --regen   （先重新生成两份预设再测）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(__dirname, '..');
const DIR = 'D:/AI/SillyTavern/Data/default-user/OpenAI Settings';
const L = path.join(R, 'extensions/cine-dialogue/logic.js');
const T = path.join(R, 'scripts/cine-dialogue-test.mjs');
const run = (c, a) => execFileSync(c, a, { cwd: R, encoding: 'utf8' });
const LOG = [];
const ok = (s) => LOG.push('  OK   ' + s);
const bad = (s) => LOG.push('  FAIL ' + s);
const info = (s) => LOG.push('  --   ' + s);
const regen = process.argv.includes('--regen');

const m = await import('file:///' + L.replace(/\\/g, '/') + '?' + Date.now());
const V = m.VERSION;
const DER = '分镜对话（专属适配）v' + V + '.json';
const UNI = '分镜对话（通用版）v' + V + '.json';
const readP = (f) => JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8'));
const ordOf = (o) => ((o.prompt_order || [])[0] || {}).order || [];

info('版本 ' + V + (regen ? '（--regen：先重新生成两份预设）' : ''));

/* ============ A 版本三处 ============ */
{
    const vm = JSON.parse(fs.readFileSync(path.join(R, 'extensions/cine-dialogue/manifest.json'), 'utf8')).version;
    const vt = (/VERSION, '([^']+)'/.exec(fs.readFileSync(T, 'utf8')) || [])[1];
    if (m.VERSION === vm && vm === vt) ok('A1 版本三处一致 ' + V);
    else bad('A1 版本不一致：logic ' + m.VERSION + ' / manifest ' + vm + ' / 夹具 ' + vt);
}
/* ============ B 语法 ============ */
{
    let allOk = true;
    for (const f of ['extensions/cine-dialogue/logic.js', 'extensions/cine-dialogue/index.js', 'extensions/cine-dialogue/buttons.js', 'scripts/cine-preset.mjs', 'scripts/cine-dialogue-test.mjs', 'scripts/cine-full-test.mjs']) {
        try { run('node', ['--check', path.join(R, f)]); } catch { allOk = false; bad('B1 语法 ' + f); }
    }
    if (allOk) ok('B1 语法 6 个文件全通过');
}
/* ============ 可选：重新生成 ============ */
/* ★ 1.7.0：**缺当前版本的预设就自动生成** ✓
   （之前升版本后忘了重新生成 ⇒ 套件直接崩 ENOENT ✗ —— 测试脚本自己该健壮 ✓） */
{
    const need = !fs.existsSync(DIR + '/' + DER) || !fs.existsSync(DIR + '/' + UNI);
    if (need && !regen) {
        info('D0 当前版本的预设缺失 ⇒ 自动重新生成（派生版 + 通用版）');
        for (const k of [1, 2]) run('node', [path.join(R, 'scripts/cine-preset.mjs')]);
        run('node', [path.join(R, 'scripts/cine-preset.mjs'), '--clean']);
    }
}
if (regen) {
    for (const f of fs.readdirSync(DIR)) if (/^分镜对话.*\.json$/.test(f)) fs.unlinkSync(DIR + '/' + f);
    for (const k of [1, 2]) run('node', [path.join(R, 'scripts/cine-preset.mjs')]);
    run('node', [path.join(R, 'scripts/cine-preset.mjs'), '--clean']);
    info('D0 已重新生成两份预设（旧文件已清）');
}
/* ============ D 生成器行为 ============ */
{
    if (!fs.existsSync(DIR + '/' + UNI)) bad('D1 通用版不存在（先跑 node scripts/cine-preset.mjs --clean）');
    else {
        const n1 = ordOf(readP(UNI)).length;
        run('node', [path.join(R, 'scripts/cine-preset.mjs'), '--clean']);
        const n2 = ordOf(readP(UNI)).length;
        if (n1 === n2) ok('D1 通用版生成幂等（两次都是 ' + n2 + ' 条）'); else bad('D1 不幂等：' + n1 + ' → ' + n2);
        /* --merge-from：在一个**刚重建**的通用版上测增量（否则会被幂等性掩盖） */
        const bak = fs.readFileSync(DIR + '/' + UNI, 'utf8');
        fs.unlinkSync(DIR + '/' + UNI);
        run('node', [path.join(R, 'scripts/cine-preset.mjs'), '--clean']);
        const before = ordOf(readP(UNI)).length;
        run('node', [path.join(R, 'scripts/cine-preset.mjs'), '--clean', '--merge-from', DER]);
        const after = ordOf(readP(UNI)).length;
        if (after > before) ok('D2 --merge-from 并入 ' + (after - before) + ' 条（' + before + ' → ' + after + '）');
        else bad('D2 --merge-from 没并入（' + before + ' → ' + after + '）');
        run('node', [path.join(R, 'scripts/cine-preset.mjs'), '--clean', '--merge-from', DER]);
        const after2 = ordOf(readP(UNI)).length;
        if (after2 === after) ok('D3 --merge-from 去重（第二次不重复并入）'); else bad('D3 重复并入：' + after + ' → ' + after2);
        /* --check 不写文件 */
        const h1 = crypto.createHash('sha256').update(fs.readFileSync(DIR + '/' + UNI)).digest('hex');
        run('node', [path.join(R, 'scripts/cine-preset.mjs'), '--check']);
        const h2 = crypto.createHash('sha256').update(fs.readFileSync(DIR + '/' + UNI)).digest('hex');
        if (h1 === h2) ok('D4 --check 不写文件'); else bad('D4 --check 改动了文件');
        fs.writeFileSync(DIR + '/' + UNI, bak, 'utf8');
        info('D5 已把通用版恢复成测试前的内容');
    }
}
/* ============ E 不变量 ============ */
function invariants(file, label) {
    if (!fs.existsSync(DIR + '/' + file)) { bad('E ' + label + ' 不存在'); return; }
    const o = readP(file);
    const P = o.prompts || [];
    const ord = ordOf(o);
    const en = new Set(ord.filter((x) => x.enabled).map((x) => String(x.identifier)));
    const nmOf = (id) => { const p = P.find((y) => String(y.identifier) === String(id)); return p ? String(p.name || '').trim() : '?'; };
    const junk = ord.filter((x) => x.enabled && /贩子|死妈|千万别点开|^📋说明/.test(nmOf(x.identifier)));
    const ironAt = ord.findIndex((x) => String(x.identifier) === 'cine-dialogue-iron');
    const guideAt = ord.findIndex((x) => /指南/.test(nmOf(x.identifier)));
    const all = P.map((p) => String(p.content || '')).join('\n');
    LOG.push('  ' + label + '：prompts ' + P.length + ' · order ' + ord.length + ' · 启用 ' + en.size);
    if (!junk.length) ok('E ' + label + ' 无启用垃圾条目'); else bad('E ' + label + ' 有启用垃圾：' + junk.map((x) => nmOf(x.identifier)).join(','));
    const expect = guideAt >= 0 ? guideAt + 1 : 1;
    if (ironAt === expect || (guideAt < 0 && ironAt >= 0 && ironAt <= 3)) ok('E ' + label + ' 铁律位置对（第 ' + ironAt + ' 位 · 指南在 ' + guideAt + '）');
    else bad('E ' + label + ' 铁律位置异常：铁律 ' + ironAt + ' / 指南 ' + guideAt);
    if (!/不小于\s*1000/.test(all) && !all.includes('正文要求写多少字')) ok('E ' + label + ' 打架的字数指令已改写');
    else bad('E ' + label + ' 仍有未改写字数指令');
    const lenP = P.find((x) => String(x.name) === m.PRESET_RECIPE.lengthName);
    if (lenP && en.has(String(lenP.identifier))) ok('E ' + label + ' 篇幅条目启用');
    else bad('E ' + label + ' 篇幅条目没启用');
}
invariants(DER, '派生版');
invariants(UNI, '通用版');

/* ============ F 预设与代码同步 ============ */
{
    const o = readP(UNI);
    const fm = (o.prompts || []).find((x) => x.name === m.PRESET_RECIPE.promptName);
    if (fm && String(fm.content) === m.stampSpec(m.FORMAT_SPEC)) ok('F1 通用版【正文行格式】与代码逐字节一致');
    else bad('F1 通用版【正文行格式】不同步');
    const o2 = readP(DER);
    const fm2 = (o2.prompts || []).find((x) => x.name === m.PRESET_RECIPE.promptName);
    if (fm2 && String(fm2.content) === m.stampSpec(m.FORMAT_SPEC)) ok('F2 派生版【正文行格式】与代码逐字节一致');
    else bad('F2 派生版【正文行格式】不同步');
    /* 篇幅条目：用户可改 ⇒ 只在"盖章还在（= 没改过）"时才要求一致
       ★ 注意：预设里的内容还要经过 fixUpstreamLength 的上游字数改写
         （我们在条目里**引用**了「不小于1000」那句 ⇒ 会被一起改写 ✓ 这是正确且自洽的）
         ⇒ 期望值 = fixUpstreamLength 作用在 stampSpec(LENGTH_SPEC) 上的结果 ✓ */
    const expectLen = (() => {
        const fake = { prompts: [{ identifier: 'x', name: m.PRESET_RECIPE.lengthName, content: m.stampSpec(m.LENGTH_SPEC) }] };
        try { m.fixUpstreamLength(fake); } catch (_) { }
        return String(fake.prompts[0].content);
    })();
    const chkLen = (obj, label) => {
        const lp = (obj.prompts || []).find((x) => x.name === m.PRESET_RECIPE.lengthName);
        if (!lp) { bad('F ' + label + ' 篇幅条目缺失'); return; }
        const c = String(lp.content);
        if (c.indexOf('（分镜对话 v') !== 0) { info('F ' + label + ' 篇幅条目被用户改过 ⇒ 跳过一致性检查（设计如此 ✓）'); return; }
        if (c === expectLen) ok('F ' + label + '【篇幅与节奏】与代码一致（含上游字数改写后的形态 ✓）');
        else {
            bad('F ' + label + '【篇幅与节奏】有盖章却与期望不一致');
            let i = 0; while (i < c.length && i < expectLen.length && c[i] === expectLen[i]) i++;
            info('    第一处不同在第 ' + i + ' 字 · 预设 ' + JSON.stringify(c.slice(i, i + 40)) + ' / 期望 ' + JSON.stringify(expectLen.slice(i, i + 40)));
        }
    };
    chkLen(o, '通用版');
    chkLen(o2, '派生版');
}
/* ============ C 夹具 ============ */
{
    let out = '', crashed = false;
    try { out = run('node', [T]); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); crashed = true; }
    const line = (out.split('\n').find((z) => /夹具：通过/.test(z)) || '(无)').trim();
    if (!crashed && /通过/.test(line) && !/失败 [1-9]/.test(line)) ok('C1 ' + line);
    else { bad('C1 ' + line); out.split('\n').filter((z) => /^\s*✗/.test(z)).slice(0, 6).forEach((z) => LOG.push('       ' + z.trim())); }
}
/* ============ G 真机渲染 ============ */
{
    const ROOT = 'D:/AI/SillyTavern/Data/default-user/chats';
    const files = [];
    (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (e.name.endsWith('.jsonl')) files.push(p); } })(ROOT);
    let n = 0, take = 0, crash = 0, nul = 0, leak = 0;
    for (const f of files) {
        for (const ln of fs.readFileSync(f, 'utf8').split('\n')) {
            if (!ln.trim()) continue;
            let o; try { o = JSON.parse(ln); } catch { continue; }
            if (o.is_user || !o.mes) continue;
            const mes = String(o.mes);
            if (!/·(动作|感官|台词|心理|旁白)/.test(mes)) continue;
            n++;
            let r; try { r = m.renderMessageHTML(mes, {}, m.DEFAULT_CONFIG); } catch { crash++; continue; }
            if (!r) { nul++; continue; }
            take++;
            /* ★ 1.9.7：折叠块（<details>，思考块/事件块）里的文字**不算可见文字** —— DOM 的 innerText 不含它们。
               模型常在思考里写「名字·动作/感官/… 格式」这类**说明**，旧口径把它当标签裸露 ⇒ 误报 ✗ */
            const vis = String(r.html)
                .replace(/<details[\s\S]*?<\/details>/gi, ' ')                                   /* 折叠块 */
                .replace(/<konatan_planning~>[\s\S]*?<\/konatan_planning~>/gi, ' ')              /* 思考块原文（模型在里面写格式说明）*/ 
                .replace(/<[^>]*>/g, '');
            if (/[^\s]{1,10}(·|・)(动作|感官|台词|心理|旁白)/.test(vis)) leak++;
        }
    }
    info('G0 语料：含分镜行的楼 ' + n + ' · 接手 ' + take);
    if (!crash) ok('G1 渲染崩溃 0'); else bad('G1 崩溃 ' + crash);
    if (!nul) ok('G2 没有该接手却返回 null 的楼'); else bad('G2 未接手 ' + nul);
    if (!leak) ok('G3 标签零裸露'); else bad('G3 标签裸露 ' + leak);
}
/* ============ H 清单 + 部署 ============ */
{
    try { run('node', [path.join(R, 'scripts/ext-index.mjs'), '--check']); ok('H1 清单 --check exit=0'); } catch { bad('H1 清单 --check 失败'); }
    const vj = JSON.parse(fs.readFileSync(path.join(R, 'extensions/index.json'), 'utf8')).extensions.find((e) => e.id === 'cine-dialogue').version;
    if (vj === V) ok('H2 清单版本 ' + vj); else bad('H2 清单版本 ' + vj + '（代码 ' + V + '）');
    const D = 'D:/AI/SillyTavern/Data/default-user/extensions/cine-dialogue';
    const h = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    let differ = [], cnt = 0;
    for (const f of fs.readdirSync(path.join(R, 'extensions/cine-dialogue'))) {
        const p = path.join(R, 'extensions/cine-dialogue', f);
        if (fs.statSync(p).isDirectory()) continue;
        cnt++;
        if (!fs.existsSync(path.join(D, f)) || h(p) !== h(path.join(D, f))) differ.push(f);
    }
    if (!differ.length) ok('H3 已装 ' + cnt + ' 文件全一致'); else bad('H3 已装不一致：' + differ.join(','));
    info('H4 已装版本 ' + (fs.existsSync(D + '/manifest.json') ? JSON.parse(fs.readFileSync(D + '/manifest.json', 'utf8')).version : '?'));
}
console.log(LOG.join('\n'));
const fails = LOG.filter((x) => x.indexOf('FAIL') >= 0);
console.log('');
console.log('FAIL 数: ' + fails.length);
process.exit(fails.length ? 1 : 0);
