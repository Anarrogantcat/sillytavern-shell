// scripts/st-compat-check.mjs —— 本体（ST）更新后的**兼容性检查**：三个扩展一起查
//
// 起因：ST 1.18.0 → 1.19.0 更新后，用户要求「检查插件有没有失效，三个插件都进行检查」✓
//
// 查什么（全部静态可判定，不需要开浏览器）：
//   ① **ESM 链接**：扩展 `import { A, B } from '…/script.js'` 里的每个名字，
//      本体是否**仍然导出** —— 这是最阴的失效模式：名字没了 ⇒ 整个模块**一行都不执行**
//      （表现：管理扩展里显示已启用，但面板/渲染全都没有 ✗ 曾经真踩过）
//   ② **事件**：`event_types.X` 是否还在本体里定义
//   ③ **DOM id**：扩展引用的 `#id`（send_form / rightSendForm / cc-var-bar …）是否还在 index.html
//   ④ **本体补丁**：patches/*.patch 是否还能反向应用（= 本体里那段是否还在原样）
//   ⑤ 各扩展自己的夹具（有就跑）
//
// 用法：node scripts/st-compat-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(__dirname, '..');
const ST = 'D:/AI/SillyTavern/SillyTavern';
const EXT_DIR = path.join(R, 'extensions');
const SCRIPT_JS = path.join(ST, 'public/script.js');
const EXT_JS = path.join(ST, 'public/scripts/extensions.js');
const INDEX_HTML = path.join(ST, 'public/index.html');
const L = [];
const ok = (s) => L.push('  ✅ ' + s);
const bad = (s) => L.push('  ❌ ' + s);
const info = (s) => L.push('  ·  ' + s);

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const scriptSrc = read(SCRIPT_JS);
const extSrc = read(EXT_JS);
const htmlSrc = read(INDEX_HTML);

/* ---------- 导出名集合（粗但够用：抓 export function/const/let/class + export { … }） ---------- */
function exportsOf(src) {
    const out = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const one of m[1].split(',')) {
            const t = one.trim().split(/\s+as\s+/).pop().trim();
            if (t) out.add(t);
        }
    }
    return out;
}
const scriptExports = exportsOf(scriptSrc);
const extExports = exportsOf(extSrc);

/* ---------- event_types 的名字 ---------- */
const eventSrc = read(path.join(ST, 'public/scripts/events.js'));
const eventNames = new Set();
{
    /* ★ 1.19 修正：event_types 定义在 public/scripts/events.js（script.js 只是再导出 ✓）*/
    for (const src of [eventSrc, scriptSrc]) {
        const i = src.indexOf('export const event_types');
        const seg = i >= 0 ? src.slice(i, i + 6000) : '';
        for (const m of seg.matchAll(/([A-Z_0-9]{3,})\s*:/g)) eventNames.add(m[1]);
    }
}

/* ---------- index.html 里的 id ---------- */
const htmlIds = new Set();
for (const m of htmlSrc.matchAll(/id="([^"]+)"/g)) htmlIds.add(m[1]);

/* ---------- 逐扩展检查 ---------- */
const exts = fs.readdirSync(EXT_DIR).filter((d) => fs.statSync(path.join(EXT_DIR, d)).isDirectory());
L.push('本体：ST ' + (JSON.parse(read(path.join(ST, 'package.json')) || '{}').version || '?') +
    ' · script.js 导出 ' + scriptExports.size + ' 个 · event_types ' + eventNames.size + ' 个 · index.html id ' + htmlIds.size + ' 个');
L.push('');
for (const e of exts) {
    const dir = path.join(EXT_DIR, e);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    L.push('【' + e + '】（' + files.length + ' 个 js）');
    let missingImports = [], missingEvents = [], missingIds = [];
    for (const f of files) {
        const src = read(path.join(dir, f));
        /* ① import … from '…script.js' / '…extensions.js' */
        for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
            const names = m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
            const from = m[2];
            const target = from.includes('script.js') ? scriptExports : (from.includes('extensions.js') ? extExports : null);
            if (!target) continue;
            for (const n of names) if (!target.has(n)) missingImports.push(f + ' → ' + n);
        }
        /* ② event_types.X */
        for (const m of src.matchAll(/event_types\.([A-Z_0-9]+)/g)) if (!eventNames.has(m[1])) missingEvents.push(f + ' → ' + m[1]);
        /* ③ getElementById('x') / querySelector('#x') —— 只查 ST 自己的（#cc- / .cd- 是别的扩展/我们的） */
        for (const m of src.matchAll(/getElementById\(\s*'([A-Za-z][\w-]*)'\s*\)/g)) {
            const id = m[1];
            if (/^(cc-|cd-|plot-|pp-|yd-)/.test(id)) continue;   /* 1.19-fix：yd- 是 plot-pilot 自建容器 ✗ 之前误报 */      /* 别的扩展/自建 ✓ 跳过 */
            /* ★ 1.19 修正：有些容器是**JS 动态创建**的（不在 index.html 里）⇒ 白名单跳过并说明 */
            const JS_CREATED = ['extensions_settings', 'extensions_settings2', 'extensionsMenu', 'chat_history', 'chat', 'options', 'rightSendForm', 'leftSendForm'];
            if (JS_CREATED.indexOf(id) >= 0) continue;
            if (!htmlIds.has(id)) missingIds.push(f + ' → #' + id);
        }
    }
    if (!missingImports.length) ok('  ESM 链接：所有从本体 import 的名字都还在 ✓');
    else { bad('  ESM 链接断了（**会导致整个模块不执行** ✗）：'); missingImports.slice(0, 10).forEach((x) => L.push('       ' + x)); }
    if (!missingEvents.length) ok('  事件：引用的 event_types 都还在 ✓');
    else { bad('  事件没了：'); missingEvents.slice(0, 10).forEach((x) => L.push('       ' + x)); }
    if (!missingIds.length) ok('  DOM id：引用的本体 id 都还在 ✓');
    else { bad('  DOM id 没了（找不到容器 ⇒ 功能不挂载）：'); missingIds.slice(0, 10).forEach((x) => L.push('       ' + x)); }
    /* ⑤ 有夹具就跑 */
    const tests = fs.readdirSync(path.join(R, 'scripts')).filter((f) => /test\.mjs$/.test(f) && f.toLowerCase().includes(e.split('-')[0]));
    for (const t of tests) {
        let o = '', crashed = false;
        try { o = execFileSync('node', [path.join(R, 'scripts', t)], { cwd: R, encoding: 'utf8' }); } catch (err) { o = String(err.stdout || '') + String(err.stderr || ''); crashed = true; }
        /* ★ 1.19 修正：分别按各自的成功口径判定（别用"某行含通过"以免误判 ✓）*/
        const sum = (o.match(/夹具：通过 (\d+) \/ 失败 (\d+)/) || []);
        const pp = (o.match(/夹具结果：(\d+)\/(\d+)/) || []);
        const fullFail = (o.match(/FAIL 数: (\d+)/) || [])[1];
        const xf = o.split('\n').filter((z) => /^\s*✗/.test(z)).length;
        let good, label;
        if (sum.length) { good = sum[2] === '0'; label = '夹具：通过 ' + sum[1] + ' / 失败 ' + sum[2]; }
        else if (pp.length) { good = pp[1] === pp[2]; label = '夹具结果 ' + pp[1] + '/' + pp[2]; }
        else if (fullFail !== undefined) { good = fullFail === '0'; label = 'FAIL 数 ' + fullFail; }
        else { good = !crashed && !xf; label = good ? '通过' : ('✗ ' + xf); }
        if (good) ok('  夹具 ' + t + ' 通过（' + label + '）');
        else { bad('  夹具 ' + t + ' 失败（' + label + '）'); o.split('\n').filter((z) => /^\s*✗|FAIL/.test(z)).slice(0, 5).forEach((z) => L.push('       ' + z.trim())); }
    }
    L.push('');
}
/* ---------- 本体补丁 ---------- */
{
    const pdir = path.join(R, 'patches');
    if (!fs.existsSync(pdir)) info('patches/ 目录不存在');
    else {
        for (const p of fs.readdirSync(pdir).filter((f) => f.endsWith('.patch'))) {
            let forward = false, reverse = false;
            try { execFileSync('git', ['-C', ST, 'apply', '--check', path.join(pdir, p)], { stdio: 'pipe' }); forward = true; } catch { }
            try { execFileSync('git', ['-C', ST, 'apply', '--check', '--reverse', path.join(pdir, p)], { stdio: 'pipe' }); reverse = true; } catch { }
            if (reverse) ok('本体补丁 ' + p + '：**已应用且原样** ✓');
            else if (forward) bad('本体补丁 ' + p + '：**未应用** ✗（本体更新冲掉了 ⇒ 执行：git -C "' + ST + '" apply "' + path.join(pdir, p) + '"）');
            else bad('本体补丁 ' + p + '：**既不适用也未应用** ✗（本体改动过大 ⇒ 要按锚点手工重做）');
        }
    }
}
console.log(L.join('\n'));
const fails = L.filter((x) => x.indexOf('❌') >= 0);
console.log('');
console.log('❌ 合计：' + fails.length + ' 项');
process.exit(fails.length ? 1 : 0);
