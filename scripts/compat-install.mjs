// scripts/compat-install.mjs — 把仓库里的 card-compat 扩展同步到 ST 数据目录
// 用法：node scripts/compat-install.mjs [dataRoot] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dataRoot = args.find(a => !a.startsWith('--')) || 'D:/AI/SillyTavern/Data';
const src = path.resolve('extensions/card-compat');
const dst = path.join(dataRoot, 'default-user/extensions/card-compat');

function hash(f) { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12); }

if (!fs.existsSync(src)) { console.error('源目录不存在: ' + src); process.exit(2); }
if (!dryRun) fs.mkdirSync(dst, { recursive: true });

const rows = [];
for (const f of fs.readdirSync(src)) {
    const from = path.join(src, f), to = path.join(dst, f);
    const before = fs.existsSync(to) ? hash(to) : '(new)';
    if (!dryRun) fs.copyFileSync(from, to);
    const after = hash(from);
    rows.push({ file: f, status: before === after ? 'unchanged' : (before === '(new)' ? 'created' : 'updated'), hash: after });
}
console.log((dryRun ? '[dry-run] ' : '') + '同步 ' + src + '  ->  ' + dst);
for (const r of rows) console.log('  ' + r.status.padEnd(9) + ' ' + r.file + '  (' + r.hash + ')');
if (!dryRun) {
    const mf = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
    console.log('校验: manifest 可解析 ✓ display_name=' + mf.display_name + ' version=' + mf.version + ' js=' + mf.js);
}
