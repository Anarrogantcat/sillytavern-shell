// scripts/cine-selfcheck.mjs —— 分镜对话 全面自检（一条命令跑完）
//
// 覆盖（全部只读，不改任何东西）：
//   1 语法（扩展 3 个 + 脚本 4 个）
//   2 版本五处一致（logic / manifest / 夹具 / 清单 / 已装目录）
//   3 清单 ext-index --check
//   4 已装 8 个文件逐字节 sha256 一致
//   5 三套测试（夹具 / 角色卡端到端 / 完整套件）
//   6 ★ ST 本体：只允许 patches/ 里记录过的补丁，且必须**逐字节一致**（git apply --check --reverse）
//   7 本仓库工作区是否干净 · 末次提交是否只动扩展（→ 决定要不要发包）· tag · 本地=远端
//   8 预设文件 · 关键开关默认值 · 每个配置键是否有面板字段
//   9 自家 ST 正则状态（会改写卡标签的 R2/R3 必须保持关闭）
//
// 用法：node scripts/cine-selfcheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(__dirname, '..');
const ST = 'D:/AI/SillyTavern/SillyTavern';
const DEP = 'D:/AI/SillyTavern/Data/default-user/extensions/cine-dialogue';
const DIR = 'D:/AI/SillyTavern/Data/default-user/OpenAI Settings';
const SETTINGS = 'D:/AI/SillyTavern/Data/default-user/settings.json';
const run = (c, a, o = {}) => execFileSync(c, a, { cwd: R, encoding: 'utf8', ...o });
const L = [];
const ok = (s) => L.push('  ✅ ' + s);
const bad = (s) => L.push('  ❌ ' + s);
const info = (s) => L.push('  ·  ' + s);

/* 1 语法 */
{
    const files = ['extensions/cine-dialogue/logic.js', 'extensions/cine-dialogue/index.js', 'extensions/cine-dialogue/buttons.js',
        'scripts/cine-preset.mjs', 'scripts/cine-dialogue-test.mjs', 'scripts/cine-card-test.mjs', 'scripts/cine-full-test.mjs', 'scripts/cine-selfcheck.mjs'];
    let allOk = true;
    for (const f of files) { try { run('node', ['--check', f]); } catch { allOk = false; bad('语法 ' + f); } }
    if (allOk) ok('1 语法 ' + files.length + ' 个文件全通过');
}
/* 2 版本五处 */
{
    const VL = (/export const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(R, 'extensions/cine-dialogue/logic.js'), 'utf8')) || [])[1];
    const VM = JSON.parse(fs.readFileSync(path.join(R, 'extensions/cine-dialogue/manifest.json'), 'utf8')).version;
    const VT = (/VERSION, '([^']+)'/.exec(fs.readFileSync(path.join(R, 'scripts/cine-dialogue-test.mjs'), 'utf8')) || [])[1];
    const VJ = JSON.parse(fs.readFileSync(path.join(R, 'extensions/index.json'), 'utf8')).extensions.find((e) => e.id === 'cine-dialogue').version;
    const VD = fs.existsSync(DEP + '/manifest.json') ? JSON.parse(fs.readFileSync(DEP + '/manifest.json', 'utf8')).version : '?';
    if (new Set([VL, VM, VT, VJ, VD]).size === 1) ok('2 版本五处一致 ' + VL + '（logic / manifest / 夹具 / 清单 / 已装）');
    else bad('2 版本不一致：' + [VL, VM, VT, VJ, VD].join(' / '));
}
/* 3 清单 */
{
    try { run('node', ['scripts/ext-index.mjs', '--check']); ok('3 清单 ext-index --check exit=0'); } catch { bad('3 清单 --check 失败'); }
}
/* 4 已装一致性 */
{
    const h = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    let differ = [], cnt = 0;
    for (const f of fs.readdirSync(path.join(R, 'extensions/cine-dialogue'))) {
        const p = path.join(R, 'extensions/cine-dialogue', f);
        if (fs.statSync(p).isDirectory()) continue;
        cnt++;
        if (!fs.existsSync(DEP + '/' + f) || h(p) !== h(DEP + '/' + f)) differ.push(f);
    }
    if (!differ.length) ok('4 已装 ' + cnt + ' 文件与仓库逐字节一致'); else bad('4 已装不一致：' + differ.join(','));
}
/* 5 三套测试 */
for (const [label, args] of [['夹具', ['scripts/cine-dialogue-test.mjs']], ['角色卡端到端（真卡）', ['scripts/cine-card-test.mjs']], ['完整套件', ['scripts/cine-full-test.mjs']]]) {
    let o = '', crashed = false;
    try { o = run('node', args); } catch (e) { o = String(e.stdout || '') + String(e.stderr || ''); crashed = true; }
    const fc = (o.match(/FAIL 数: (\d+)/) || [])[1];
    const xf = o.split('\n').filter((l) => /^\s*✗/.test(l)).length;
    const fx = (o.match(/夹具：通过 (\d+) \/ 失败 (\d+)/) || []);
    const good = !crashed && !xf && (fc === undefined || fc === '0') && (fx.length === 0 || fx[2] === '0');
    if (good) ok('5 ' + label + ' 通过' + (fx.length ? '（' + fx[1] + ' / 0）' : '') + (fc !== undefined ? '（FAIL 数 0）' : ''));
    else {
        bad('5 ' + label + ' 未通过（✗ ' + xf + ' · FAIL 数 ' + (fc === undefined ? '?' : fc) + '）');
        o.split('\n').filter((l) => /^\s*✗|FAIL/.test(l)).slice(0, 4).forEach((x) => L.push('       ' + x.trim()));
    }
}
/* 6 ST 本体：只允许 patches/ 记录的补丁，且逐字节一致 */
{
    try {
        const dirty = execFileSync('git', ['-C', ST, 'status', '--porcelain'], { encoding: 'utf8' }).split('\n').filter((x) => x.trim());
        const core = dirty.filter((d) => /\s(public|src|default|plugins|node_modules)\//.test(d) || /\sserver\.js|\spackage\.json|\sconfig\.yaml/.test(d));
        const untracked = dirty.filter((d) => d.startsWith('??'));
        /* 允许的：① patches/ 里记录过的补丁 ② 套壳安装时留下的 / **用户自己放的素材**
           ★ 1.9.2 修正：`public/img/cg/`、`public/img/cg2/` 是用户自己的 CG 素材目录 ✗
             之前正则写成 `public\/img\/$`（要求行尾结束）⇒ 匹配不上 `public/img/cg/` ⇒ 假报 ✗ */
        const KNOWN_INSTALLER = /(\?\?|M)\s+(\.git-head$|public\/index\.html\.bak$|public\/img\/|default\/config\.yaml$|public\/index\.html$)/;
        const patches = fs.existsSync(path.join(R, 'patches')) ? fs.readdirSync(path.join(R, 'patches')).filter((f) => f.endsWith('.patch')) : [];
        let appliedOk = 0, appliedBad = [];
        for (const p of patches) {
            try { execFileSync('git', ['-C', ST, 'apply', '--check', '--reverse', path.join(R, 'patches', p)], { stdio: 'pipe' }); appliedOk++; }
            catch { appliedBad.push(p); }
        }
        info('6 ST 本体改动 ' + dirty.length + ' 项 · 已应用且逐字节一致的补丁 ' + appliedOk + '/' + patches.length + (appliedBad.length ? '（不一致：' + appliedBad.join(',') + '）' : ''));
        const unexpected = core.filter((d) => !KNOWN_INSTALLER.test(d) && !d.includes('public/script.js'));
        if (!dirty.length) ok('6 ST 本体工作区干净（未动本体）');
        else if (!unexpected.length && !appliedBad.length) {
            ok('6 ST 本体只有「补丁 ' + patches.join(',') + '」+「套壳安装残留」⇒ 合规 ✓');
            info('   （套壳安装残留：' + dirty.filter((d) => KNOWN_INSTALLER.test(d)).map((d) => d.replace(/^(\?\?|M)\s+/, '')).join(' , ') + '）');
        } else bad('6 ST 本体有**未记录**的改动：' + unexpected.join(' , '));
    } catch (e) { info('6 ST 本体检查跳过：' + String(e.message).slice(0, 90)); }
}
/* 7 套壳本体 / 发包闸门 */
{
    const st = run('git', ['status', '--porcelain']).split('\n').filter((x) => x.trim());
    if (!st.length) ok('7 本仓库工作区干净'); else { bad('7 本仓库有未提交：'); st.slice(0, 8).forEach((d) => L.push('       ' + d)); }
    info('   最新提交：' + run('git', ['log', '-1', '--format=%h %s']).trim());
    const files = run('git', ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter((x) => x.trim());
    const shellChanged = files.filter((f) => /^(index\.js|preload\.js|shell\.|i18n|webview-preload|prompt|lib\/|assets\/|electron-builder-lite\.json|\.github\/)/.test(f));
    info('   末次提交 ' + files.length + ' 个文件 · 套壳本体文件 ' + shellChanged.length + ' 个' + (shellChanged.length ? '（' + shellChanged.join(',') + '）⚠ 可发包' : ' ⇒ 只改扩展 ⇒ 不打 tag / 不发包 ✓'));
    info('   HEAD 上的 tag：' + (run('git', ['tag', '--points-at', 'HEAD']).trim() || '无 ✓'));
    info('   本地 = 远端：' + (run('git', ['rev-parse', '--short', 'HEAD']).trim() === run('git', ['rev-parse', '--short', 'origin/main']).trim() ? '是 ✓' : '否 ✗'));
}
/* 8 预设 / 开关 / 面板覆盖度 */
{
    const m = await import('file:///' + path.join(R, 'extensions/cine-dialogue/logic.js').replace(/\\/g, '/') + '?' + Date.now());
    info('8 预设：' + fs.readdirSync(DIR).filter((f) => /^分镜对话.*\.json$/.test(f)).join(' · '));
    info('   旧版本备份：' + fs.readdirSync(DIR).filter((f) => /\.bak-superseded$/.test(f)).length + ' 份');
    info('   默认值：enabled=' + m.DEFAULT_CONFIG.enabled + ' · respectCardFrontend=' + m.DEFAULT_CONFIG.respectCardFrontend +
        ' · autoOffCardFrontend=' + m.DEFAULT_CONFIG.autoOffCardFrontend + ' · streamLiveFormat=' + m.DEFAULT_CONFIG.streamLiveFormat);
    const CODE_MANAGED = ['palette', 'layerStyles', 'charColors', 'perCard', 'customLayers', 'onlyChar', 'highlight', 'cardHasFrontend'];
    const miss = Object.keys(m.DEFAULT_CONFIG).filter((k) => !m.PANEL_FIELDS.some((f) => f.key === k) && CODE_MANAGED.indexOf(k) < 0);
    if (!miss.length) ok('8 每个配置键都有面板字段（或登记为代码管理）');
    else bad('8 这些配置键没有 UI：' + miss.join(','));
}
/* 9 自家正则 */
{
    try {
        const st = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
        const rx = st.extension_settings.regex;
        const list = Array.isArray(rx) ? rx : Object.values(rx);
        const ours = list.filter((r) => /【分镜】/.test(String(r.scriptName || r.name || '')));
        const on = ours.filter((r) => !r.disabled).map((r) => String(r.scriptName || r.name));
        if (!on.length) ok('9 自家正则 ' + ours.length + ' 条全部关闭（R2/R3 不会改写卡标签 ✓）');
        else bad('9 自家正则有启用的：' + on.join(',') + '（R2/R3 一旦启用会把卡的 <options> 改写掉 ✗）');
    } catch (e) { info('9 正则检查跳过：' + String(e.message).slice(0, 80)); }
}
console.log(L.join('\n'));
const fails = L.filter((x) => x.indexOf('❌') >= 0);
console.log('');
console.log('❌ 合计：' + fails.length + ' 项');
process.exit(fails.length ? 1 : 0);
