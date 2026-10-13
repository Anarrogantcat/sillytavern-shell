// scripts/cine-dialogue-audit.mjs —— 分镜对话：机械自检
//
// 为什么要有它：本会话里犯的几类错，靠"再看一眼"根本发现不了 ——
//   · 漏导入（一次让整个扩展不执行）
//   · 内置兜底 CSS 与 style.css 漏同步（漏过 .custom-cd-anchor）
//   · 面板字段漏分组 / 配置键拼错
//   · 版本号多处不一致 / CHANGELOG 漏记
// 所以把能机械判定的都做成这个脚本：`npm run ext:audit`
//
// ★ 设计原则：**宁可少报，不可误报** —— 狼来了的守卫等于没有守卫。
//   初版误报过三处：手写 UI 的配置键（onlyChar/highlight）、plot-pilot 自己的 #plot-pilot-bar、
//   以及把"定义 + 一次使用"误判成死代码。都已在下面修正。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(R, 'extensions', 'cine-dialogue');
const read = (p) => fs.readFileSync(p, 'utf8');

const log = read(path.join(EXT, 'logic.js'));
const idx = read(path.join(EXT, 'index.js'));
const css = read(path.join(EXT, 'style.css'));
const tests = read(path.join(R, 'scripts', 'cine-dialogue-test.mjs'));

let fail = 0;
let warn = 0;
const ok = (t) => console.log('  \u2713 ' + t);
const bad = (t, d) => { fail++; console.log('  \u2717 ' + t + (d === undefined ? '' : '  \u2192 ' + JSON.stringify(d))); };
const soft = (t, d) => { warn++; console.log('  \u26a0 ' + t + (d === undefined ? '' : '  \u2192 ' + JSON.stringify(d))); };

// ---------------------------------------------------------------- A 语法
console.log('A. 语法');
for (const f of ['index.js', 'logic.js']) {
    try {
        execFileSync(process.execPath, ['--check', path.join(EXT, f)], { stdio: 'pipe' });
        ok(f);
    } catch (e) {
        bad(f + ' 语法错误', String(e.stderr || '').slice(0, 140));
    }
}

// ---------------------------------------------------------------- B 配置键三向核对
console.log('B. 配置键（配置 / 面板字段 / 手写 UI）');
const defStart = log.indexOf('export const DEFAULT_CONFIG');
const defBlock = log.slice(defStart, log.indexOf('};', defStart));
const cfgKeys = [...defBlock.matchAll(/^\s{4}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
const panelKeys = [...log.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1]);
// 手写 UI 的键：真有入口，只是没走 PANEL_FIELDS（新增手写 UI 时请同步这里）
const HAND_UI = ['onlyChar', 'highlight'];
// 由代码托管、不在面板里手改的键
const MANAGED = ['palette', 'layerStyles', 'charColors', 'perCard', 'customLayers'];
ok('配置键 ' + cfgKeys.length + ' · 面板字段 ' + panelKeys.length + ' · 手写 UI ' + HAND_UI.length);

const noEntry = cfgKeys.filter((k) => panelKeys.indexOf(k) < 0 && MANAGED.indexOf(k) < 0 && HAND_UI.indexOf(k) < 0);
if (noEntry.length) bad('这些配置键用户改不到（既无面板字段也无手写 UI）', noEntry); else ok('每个配置键都有入口');

const ghost = panelKeys.filter((k) => cfgKeys.indexOf(k) < 0);
if (ghost.length) bad('面板里有、配置里没有的键（拼错）', ghost); else ok('面板字段没有拼错的键');

const nogroup = [...log.matchAll(/\{\s*key:\s*'([^']+)',([^}]*)\}/g)]
    .filter((m) => !/group:/.test(m[2])).map((m) => m[1]);
if (nogroup.length) bad('面板字段漏写 group（会被静默漏渲染）', nogroup); else ok('面板字段全部归组');

// ---------------------------------------------------------------- C CSS 白名单
console.log('C. CSS 选择器白名单（只能用自有前缀）');
const PREFIX = {
    'cine-dialogue': /^(#cd-panel|#cd-style|\.cd-|\.custom-cd-)/,
    'card-compat': /^(#cc-panel|#cc-var-bar|\.cc-|\.[a-z-]*cc-)/,
    'plot-pilot': /^(#pp-panel|#plot-pilot-bar|\.pp-)/,
};
for (const id of Object.keys(PREFIX)) {
    const p = path.join(R, 'extensions', id, 'style.css');
    if (!fs.existsSync(p)) { soft(id + ' 没有 style.css'); continue; }
    const c = read(p).replace(/\/\*[\s\S]*?\*\//g, '');
    const sels = [...c.matchAll(/(^|[}])\s*([^{}@]+)\{/g)].map((m) => m[2].trim());
    const badSel = sels.filter((s) => !s.split(',').every((o) => { const t = o.trim(); return !t || PREFIX[id].test(t); }));
    if (badSel.length) bad(id + ' 有越界选择器', badSel.slice(0, 4));
    else ok(id + '：' + sels.length + ' 个选择器全在自有前缀内');
}

// ---------------------------------------------------------------- D 兜底 CSS 同步
console.log('D. 内置兜底 CSS 与 style.css 的同步');
const NEED = ['.custom-cd-root', '.custom-cd-grid', '.custom-cd-row', '.custom-cd-who', '.custom-cd-body', '.custom-cd-anchor', '.cd-tw'];
const miss = NEED.filter((k) => css.indexOf(k) >= 0 && idx.indexOf(k) < 0);
if (miss.length) bad('style.css 有、内置兜底缺（取不到 style.css 时会失效）', miss);
else ok('关键规则两边都有（' + NEED.length + ' 条）');

// ---------------------------------------------------------------- E 版本 / CHANGELOG
console.log('E. 版本与 CHANGELOG');
const v = {
    logic: (log.match(/export const VERSION = '([^']+)'/) || [])[1],
    manifest: JSON.parse(read(path.join(EXT, 'manifest.json'))).version,
    test: (tests.match(/VERSION,\s*'([^']+)'/) || [])[1],
};
try {
    const ij = JSON.parse(read(path.join(R, 'extensions', 'index.json')));
    v.index = (ij.extensions.find((e) => e.id === 'cine-dialogue') || {}).version;
} catch { v.index = '(读不到)'; }
if (Object.values(v).every((x) => x === v.logic)) ok('四处一致：' + v.logic); else bad('版本不一致', v);

const cl = read(path.join(EXT, 'CHANGELOG.md'));
if (cl.indexOf('## v' + v.logic) >= 0) ok('扩展 CHANGELOG 有 v' + v.logic + ' 条目'); else bad('扩展 CHANGELOG 漏记 v' + v.logic);
if (read(path.join(R, 'CHANGELOG.md')).indexOf(v.logic) >= 0) ok('根 CHANGELOG 提到 ' + v.logic); else soft('根 CHANGELOG 没提到 ' + v.logic);

// ---------------------------------------------------------------- F 死代码
console.log('F. 死代码（导出但全仓库零使用）');
const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (['node_modules', '.git', 'vendor'].indexOf(e.name) >= 0) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|mjs)$/.test(e.name)) files.push(p);
    }
})(R);
const allSrc = files.map((f) => read(f));
const exp = [...log.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
const dead = [];
for (const n of exp) {
    const re = new RegExp('(?<![\\w$.])' + n + '(?![\\w$])', 'g');
    let total = 0;
    for (const t of allSrc) total += (t.match(re) || []).length;
    // 定义本身占 1 次；只剩 1 次 ⇒ 没人用（★ 正确判据：不能只看 index.js/夹具）
    if (total <= 1) dead.push(n);
}
if (dead.length) bad('导出但全仓库零使用', dead); else ok(exp.length + ' 个导出都有使用');

// ---------------------------------------------------------------- G 仓库 / 已装目录
console.log('G. 仓库与已装目录');
try {
    const st = execFileSync('git', ['status', '--porcelain'], { cwd: R, encoding: 'utf8' }).trim();
    if (st) soft('有未提交改动：' + st.split('\n').length + ' 个文件'); else ok('git 干净');
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: R, encoding: 'utf8' }).trim();
    const ori = execFileSync('git', ['rev-parse', '--short', 'origin/main'], { cwd: R, encoding: 'utf8' }).trim();
    if (head === ori) ok('HEAD == origin/main（' + head + '）'); else soft('未推送：HEAD ' + head + ' / origin ' + ori);
} catch (e) { soft('git 检查失败', String(e.message).slice(0, 80)); }

const dst = 'D:/AI/SillyTavern/Data/default-user/extensions/cine-dialogue';
try {
    const { createHash } = await import('node:crypto');
    const h = (f) => createHash('sha256').update(read(f)).digest('hex').slice(0, 10);
    let differ = 0;
    let n = 0;
    for (const f of fs.readdirSync(EXT)) {
        const b = path.join(dst, f);
        if (!fs.existsSync(b)) { differ++; continue; }
        if (h(path.join(EXT, f)) !== h(b)) differ++;
        n++;
    }
    if (differ) bad('已装目录与仓库不一致', { n, differ }); else ok('已装目录 ' + n + ' 个文件一致');
} catch (e) { soft('已装目录检查跳过', String(e.message).slice(0, 60)); }

console.log('');
console.log(fail
    ? ('\u2717 自检不通过：' + fail + ' 项失败' + (warn ? '，' + warn + ' 项提醒' : ''))
    : ('\u2713 自检通过' + (warn ? '（' + warn + ' 项提醒）' : '')));
process.exit(fail ? 1 : 0);
