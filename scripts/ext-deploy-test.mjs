// scripts/ext-deploy-test.mjs — 内置扩展部署逻辑夹具（临时目录，纯本地）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, planDeploy, deployExtensions, listBundled, hashTree, buildSummary, RECORD_NAME, extensionsRoot } from '../lib/ext-deploy.js';
import { guardDowngrade, syncExtension } from '../scripts/ext-install.mjs';

let pass = 0; const fails = [];
const ok = (n, c, extra) => { if (c) pass++; else fails.push(n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { actual: a, expected: b });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-extdeploy-'));
const srcRoot = path.join(tmp, 'bundled');
const dataRoot = path.join(tmp, 'Data');
function writeExt(root, id, version, files = {}) {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ display_name: id, version, js: 'index.js' }), 'utf8');
    fs.writeFileSync(path.join(dir, 'index.js'), '// ' + id + ' v' + version + '\n', 'utf8');
    for (const [rel, body] of Object.entries(files)) {
        const p = path.join(dir, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, body, 'utf8');
    }
    return dir;
}

// ── 版本比较 ──
eq('版本 0.2.1 < 0.10.0', compareVersions('0.2.1', '0.10.0'), -1);
eq('版本 1.35.1 = 1.35.1', compareVersions('1.35.1', '1.35.1'), 0);
eq('版本 1.36.0 > 1.35.1', compareVersions('1.36.0', '1.35.1'), 1);
eq('版本 空/非法按 0', compareVersions('', '0.0.1'), -1);

// ── 全新安装（目标目录不存在，但 ST 数据目录已初始化） ──
// 说明：套壳不会替 ST 建 default-user（那是 ST 首次运行的事），所以这里先模拟 ST 已跑过一次
fs.mkdirSync(path.join(dataRoot, 'default-user'), { recursive: true });
writeExt(srcRoot, 'card-compat', '0.2.1');
writeExt(srcRoot, 'plot-pilot', '0.1.1', { 'style.css': 'body{}' });
eq('清单读到 2 个内置扩展', listBundled(srcRoot).map((x) => x.id).sort(), ['card-compat', 'plot-pilot']);
let logs = [];
let r = deployExtensions({ srcRoot, dataRoot, log: (s) => logs.push(s) });
eq('全新安装 2 个', r.deployed.map((x) => x.action), ['install', 'install']);
eq('安装后文件落地', fs.existsSync(path.join(extensionsRoot(dataRoot), 'card-compat', 'index.js')), true);
eq('子目录文件也落地', fs.existsSync(path.join(extensionsRoot(dataRoot), 'plot-pilot', 'style.css')), true);
eq('留下部署记录', fs.existsSync(path.join(extensionsRoot(dataRoot), 'card-compat', RECORD_NAME)), true);
const record = JSON.parse(fs.readFileSync(path.join(extensionsRoot(dataRoot), 'card-compat', RECORD_NAME), 'utf8'));
eq('记录版本正确', record.version, '0.2.1');
eq('记录哈希与源一致', record.hash, hashTree(path.join(srcRoot, 'card-compat')));

// ── 再跑一次：幂等 ──
logs = [];
r = deployExtensions({ srcRoot, dataRoot, log: (s) => logs.push(s) });
eq('第二次全部跳过', [r.deployed.length, r.skipped.map((x) => x.action)], [0, ['skip-same', 'skip-same']]);

// ── 升级：内置版本更高 → 覆盖 ──
writeExt(srcRoot, 'card-compat', '0.3.0');
r = deployExtensions({ srcRoot, dataRoot, log: () => {} });
eq('高版本触发更新', r.deployed.map((x) => x.id + ':' + x.action), ['card-compat:update']);
eq('内容确实更新', fs.readFileSync(path.join(extensionsRoot(dataRoot), 'card-compat', 'index.js'), 'utf8').includes('v0.3.0'), true);

// ── 降级保护：目标版本更高 → 不降级 ──
writeExt(srcRoot, 'card-compat', '0.2.0');
r = deployExtensions({ srcRoot, dataRoot, log: () => {} });
eq('低版本不降级', [r.deployed.length, r.skipped[0].action], [0, 'skip-newer']);
eq('目标版本未被改回', JSON.parse(fs.readFileSync(path.join(extensionsRoot(dataRoot), 'card-compat', 'manifest.json'), 'utf8')).version, '0.3.0');

// ── 用户自己的扩展目录：不碰 ──
const userDir = path.join(extensionsRoot(dataRoot), 'JS-Slash-Runner');
fs.mkdirSync(userDir, { recursive: true });
fs.writeFileSync(path.join(userDir, 'manifest.json'), JSON.stringify({ display_name: 'user own', version: '9.9.9' }), 'utf8');
r = deployExtensions({ srcRoot, dataRoot, log: () => {} });
eq('未知扩展不被写入', fs.readdirSync(userDir).sort(), ['manifest.json']);
eq('未知扩展不在报告里', r.deployed.concat(r.skipped).some((x) => x.id === 'JS-Slash-Runner'), false);

// ── 目标目录存在但不是合规扩展 → 不碰 ──
const weird = path.join(extensionsRoot(dataRoot), 'card-compat');
fs.rmSync(path.join(weird, 'manifest.json'));
r = deployExtensions({ srcRoot, dataRoot, log: () => {} });
eq('无 manifest 的目标跳过', r.skipped.some((x) => x.id === 'card-compat' && x.action === 'skip-unknown'), true);

// ── 数据目录尚未初始化 → 报告并让调用方重试 ──
const emptyRoot = path.join(tmp, 'NotYet');
r = deployExtensions({ srcRoot, dataRoot: emptyRoot, log: () => {} });
eq('数据目录缺失时返回 dataRootMissing', [r.dataRootMissing, r.deployed.length], [true, 0]);
eq('缺失时不创建任何目录', fs.existsSync(path.join(emptyRoot, 'default-user')), false);

// ── planDeploy 与 force ──
const freshData = path.join(tmp, 'Data2');
const plan = planDeploy({ srcRoot, dataRoot: freshData });
eq('plan 只给判断不落盘', [plan.map((x) => x.action), fs.existsSync(path.join(freshData, 'default-user'))], [['install', 'install'], false]);
const p2 = planDeploy({ srcRoot, dataRoot, force: true });
eq('force 时同版本也覆盖', p2.some((x) => x.id === 'plot-pilot' && x.action === 'update'), true);

// ── 加固①：quiet 模式（启动不再逐条刷"已是最新"） ──
const qRoot = path.join(tmp, 'Quiet');
fs.mkdirSync(path.join(qRoot, 'default-user'), { recursive: true });
let qLogs = [];
let qr = deployExtensions({ srcRoot, dataRoot: qRoot, quiet: true, log: (s) => qLogs.push(s) });
eq('quiet 模式没有"跳过"日志', qLogs.filter((s) => s.includes('跳过')).length, 0);
ok('quiet 摘要含"已安装"', buildSummary(qr).includes('已安装'), buildSummary(qr));
qLogs = [];
qr = deployExtensions({ srcRoot, dataRoot: qRoot, quiet: true, log: (s) => qLogs.push(s) });
eq('quiet + 无动作 → 一行都不打', qLogs.length, 0);
eq('摘要=均为最新', buildSummary(qr), '均为最新');

// ── 加固②：安装器降级保护（默认不覆盖更高版本） ──
const repoRoot = path.join(tmp, 'repo');
writeExt(path.join(repoRoot, 'extensions'), 'card-compat', '0.1.0');
const instData = path.join(tmp, 'Data3');
writeExt(path.join(instData, 'default-user', 'extensions'), 'card-compat', '0.2.0');
eq('降级保护：目标更新 → 拦', guardDowngrade('card-compat', { repoRoot, dataRoot: instData }).block, true);
eq('降级保护：force 放行', guardDowngrade('card-compat', { repoRoot, dataRoot: instData, force: true }).block, false);
eq('降级保护：目标更旧 → 不拦', guardDowngrade('card-compat', { repoRoot, dataRoot: path.join(tmp, 'Data4') }).block, false);
const s1 = syncExtension('card-compat', { repoRoot, dataRoot: instData, log: () => {} });
eq('同步被拦下：不写文件', [s1.blocked, s1.changed], [true, 0]);
eq('目标内容未被改', fs.readFileSync(path.join(instData, 'default-user', 'extensions', 'card-compat', 'index.js'), 'utf8').includes('v0.2.0'), true);
const s2 = syncExtension('card-compat', { repoRoot, dataRoot: instData, force: true, log: () => {} });
ok('force 后确实覆盖', !s2.blocked && s2.changed > 0, { blocked: s2.blocked, changed: s2.changed });
eq('覆盖后版本回落到仓库版本', fs.readFileSync(path.join(instData, 'default-user', 'extensions', 'card-compat', 'index.js'), 'utf8').includes('v0.1.0'), true);

// ── 仓库一致性：extensions/index.json 必须与当前扩展内容一致（解耦通道的前提） ──
const { buildIndex, coreOf, INDEX_FILE } = await import('./ext-index.mjs');
const indexPath = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'extensions', INDEX_FILE);
ok('extensions/index.json 存在', fs.existsSync(indexPath), indexPath);
if (fs.existsSync(indexPath)) {
    const cur = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const next = buildIndex(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    eq('index.json 与扩展内容一致（改了扩展记得 node scripts/ext-index.mjs）', coreOf(cur) === coreOf(next), true);
    eq('index.json 列出全部内置扩展', cur.extensions.map((e) => e.id).sort(), next.extensions.map((e) => e.id).sort());
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
if (fails.length) { console.log('夹具结果：' + pass + ' 项通过，' + fails.length + ' 项失败'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('夹具结果：' + pass + '/' + pass + ' 全部通过');
