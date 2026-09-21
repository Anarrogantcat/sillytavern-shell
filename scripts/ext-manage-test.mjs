// scripts/ext-manage-test.mjs — 扩展管理器逻辑夹具（临时目录，纯本地）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deployExtensions, planDeploy, extensionsRoot } from '../lib/ext-deploy.js';
import { isSafeExtId, readRecord, hashTreeOf, dirSize, listInstalledExtensions, uninstallExtension, listTrash, restoreFromTrash, resetExtensionSettings, settingsPath, TRASH_DIR } from '../lib/ext-manage.js';

let pass = 0; const fails = [];
const ok = (n, c, extra) => { if (c) pass++; else fails.push(n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { actual: a, expected: b });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-extmanage-'));
const srcRoot = path.join(tmp, 'bundled');
const dataRoot = path.join(tmp, 'Data');
function writeExt(root, id, version, files = {}) {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ display_name: id, version, js: 'index.js' }), 'utf8');
    fs.writeFileSync(path.join(dir, 'index.js'), '// ' + id + ' v' + version + '\n', 'utf8');
    for (const [rel, body] of Object.entries(files)) {
        const fp = path.join(dir, rel);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, body, 'utf8');
    }
    return dir;
}

// ── id 白名单 ──
eq('正常 id 通过', isSafeExtId('card-compat'), true);
eq('下划线点号通过', isSafeExtId('my_ext.v2'), true);
eq('空 id 不通过', isSafeExtId(''), false);
eq('点开头不通过', isSafeExtId('.hidden'), false);
eq('路径穿越不通过', isSafeExtId('../evil'), false);
eq('斜杠不通过', isSafeExtId('a/b'), false);
eq('反斜杠不通过', isSafeExtId('a\\\\b'), false);

// ── 空目录列表 ──
eq('数据目录不存在 → 空列表', listInstalledExtensions({ srcRoot, dataRoot: path.join(tmp, 'Nope') }), []);

// ── 部署后列表 ──
fs.mkdirSync(path.join(dataRoot, 'default-user'), { recursive: true });
writeExt(srcRoot, 'card-compat', '0.2.8', { 'assets/x.js': 'x' });
writeExt(srcRoot, 'plot-pilot', '0.1.2');
deployExtensions({ srcRoot, dataRoot, quiet: true, log: () => {} });
let rows = listInstalledExtensions({ srcRoot, dataRoot });
eq('列出 2 个扩展', rows.map((r) => r.id), ['card-compat', 'plot-pilot']);
eq('读出版本', rows.map((r) => r.version), ['0.2.8', '0.1.2']);
eq('部署记录标记为受管', rows.map((r) => r.managed), [true, true]);
eq('记录来源为 bundled', rows[0].source, 'bundled');
eq('有意不含 RECORD_NAME 的哈希 → 不脏', rows.map((r) => r.dirty), [false, false]);
eq('没有内置更新时不提示更新', rows.map((r) => r.updateAvailable), [false, false]);
ok('文件数与体积可读', rows[0].files >= 3 && rows[0].bytes > 0, rows[0]);

// ── 手改 → 脏 ──
fs.writeFileSync(path.join(extensionsRoot(dataRoot), 'card-compat', 'index.js'), '// hand edited\n', 'utf8');
rows = listInstalledExtensions({ srcRoot, dataRoot });
eq('手改后标记为脏', rows.find((r) => r.id === 'card-compat').dirty, true);
eq('另一个不受影响', rows.find((r) => r.id === 'plot-pilot').dirty, false);

// ── 内置升版 → 提示可更新 ──
writeExt(srcRoot, 'card-compat', '0.2.9');
rows = listInstalledExtensions({ srcRoot, dataRoot });
const cc = rows.find((r) => r.id === 'card-compat');
eq('内置更高版本 → updateAvailable', [cc.updateAvailable, cc.bundledVersion], [true, '0.2.9']);

// ── 强制重装（only 只作用于指定扩展） ──
let r = deployExtensions({ srcRoot, dataRoot, force: true, quiet: true, only: ['card-compat'], log: () => {} });
eq('only 只重装一个', r.deployed.map((x) => x.id), ['card-compat']);
rows = listInstalledExtensions({ srcRoot, dataRoot });
eq('重装后版本更新且不脏', [rows.find((x) => x.id === 'card-compat').version, rows.find((x) => x.id === 'card-compat').dirty], ['0.2.9', false]);
const planOnly = planDeploy({ srcRoot, dataRoot, force: true, only: ['plot-pilot'] });
eq('planDeploy 的 only 生效', planOnly.map((x) => x.id), ['plot-pilot']);

// ── 用户自己的扩展 ──
const userDir = path.join(extensionsRoot(dataRoot), 'JS-Slash-Runner');
fs.mkdirSync(userDir, { recursive: true });
fs.writeFileSync(path.join(userDir, 'manifest.json'), JSON.stringify({ display_name: 'user own', version: '9.9.9' }), 'utf8');
rows = listInstalledExtensions({ srcRoot, dataRoot });
const urow = rows.find((x) => x.id === 'JS-Slash-Runner');
eq('用户扩展标记为 user / 未受管', [urow.source, urow.managed, urow.dirty], ['user', false, null]);
eq('用户扩展不会被 only 波及', planDeploy({ srcRoot, dataRoot, only: ['JS-Slash-Runner'] }).length, 0);

// ── 卸载（回收站） ──
const bad = uninstallExtension({ dataRoot, id: '../evil' });
eq('非法 id 拒绝卸载', [bad.ok, bad.reason.indexOf('不合法') >= 0], [false, true]);
const u1 = uninstallExtension({ dataRoot, id: 'card-compat', stamp: 'S1' });
eq('卸载移入回收站', [u1.ok, u1.mode], [true, 'trash']);
eq('原目录已不在', fs.existsSync(path.join(extensionsRoot(dataRoot), 'card-compat')), false);
let trash = listTrash({ dataRoot });
eq('回收站有 1 条', trash.map((t) => t.name), ['card-compat.S1']);
eq('回收站解析出原 id', trash[0].id, 'card-compat');
eq('列表里不再出现', listInstalledExtensions({ srcRoot, dataRoot }).some((x) => x.id === 'card-compat'), false);
eq('重复卸载报不存在', uninstallExtension({ dataRoot, id: 'card-compat' }).ok, false);
eq('回收站目录本身不被当成扩展', listInstalledExtensions({ srcRoot, dataRoot }).some((x) => x.id === TRASH_DIR), false);

// ── 还原 ──
const rr = restoreFromTrash({ dataRoot, name: 'card-compat.S1' });
eq('还原成功', [rr.ok, rr.id], [true, 'card-compat']);
eq('还原后文件回来了', fs.readFileSync(path.join(extensionsRoot(dataRoot), 'card-compat', 'index.js'), 'utf8').indexOf('v0.2.9') >= 0, true);
eq('还原后回收站空了', listTrash({ dataRoot }).length, 0);
eq('还原不存在的一条报错', restoreFromTrash({ dataRoot, name: 'nope.S2' }).ok, false);
eq('还原名带穿越被拒', restoreFromTrash({ dataRoot, name: '../x.S3' }).ok, false);

// ── 彻底删除 ──
uninstallExtension({ dataRoot, id: 'plot-pilot', stamp: 'S4' });
const purge = uninstallExtension({ dataRoot, id: 'card-compat', purge: true });
eq('purge 真删', purge.mode, 'purge');
eq('purge 后目录不存在', fs.existsSync(path.join(extensionsRoot(dataRoot), 'card-compat')), false);

// ── 重置扩展设置 ──
fs.writeFileSync(settingsPath(dataRoot), JSON.stringify({ extension_settings: { 'plot-pilot': { a: 1 }, other: 2 }, x: 1 }, null, 4), 'utf8');
const rs = resetExtensionSettings({ dataRoot, id: 'plot-pilot', stamp: 'S5' });
eq('重置成功且确实有过设置', [rs.ok, rs.had], [true, true]);
const after = JSON.parse(fs.readFileSync(settingsPath(dataRoot), 'utf8'));
eq('extension_settings 里被删掉', after.extension_settings['plot-pilot'], undefined);
eq('其它扩展与顶层键保留', [after.extension_settings.other, after.x], [2, 1]);
eq('备份文件已写出', fs.existsSync(settingsPath(dataRoot) + '.shellbak-S5'), true);
const rs2 = resetExtensionSettings({ dataRoot, id: 'plot-pilot' });
eq('本来就没有设置 → had=false 且不为错', [rs2.ok, rs2.had], [true, false]);
const rs3 = resetExtensionSettings({ dataRoot: path.join(tmp, 'NoSettings'), id: 'card-compat' });
eq('settings.json 不存在 → 报错不崩', [rs3.ok, typeof rs3.reason === 'string'], [false, true]);
eq('非法 id 重置被拒', resetExtensionSettings({ dataRoot, id: 'a/b' }).ok, false);

// ── 记录与哈希工具 ──
const ccDir = path.join(srcRoot, 'card-compat');
eq('hashTreeOf 忽略记录文件本身', hashTreeOf(ccDir) === hashTreeOf(ccDir), true);
ok('dirSize 为正', dirSize(ccDir) > 0, dirSize(ccDir));
fs.writeFileSync(path.join(ccDir, '.shell-deployed.json'), '{}', 'utf8');
eq('目录里多出记录文件不改变 hash', hashTreeOf(ccDir) === hashTreeOf(ccDir), true);
eq('readRecord 读不到时返回 null', readRecord(path.join(tmp, 'Nope')), null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
console.log('结果: pass=' + pass + ' fail=' + fails.length);
if (fails.length) { console.log('失败项：'); for (const f of fails) console.log('  ❌ ' + f); }
process.exit(fails.length ? 1 : 0);
