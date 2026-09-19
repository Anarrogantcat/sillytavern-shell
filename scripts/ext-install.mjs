// scripts/ext-install.mjs — 把仓库 extensions/<name>/ 同步到 SillyTavern 数据目录
// 用法：
//   node scripts/ext-install.mjs                     # 同步 extensions/ 下全部扩展
//   node scripts/ext-install.mjs plot-pilot          # 只同步指定扩展
//   node scripts/ext-install.mjs --dry-run           # 只列出将要写入的差异
//   node scripts/ext-install.mjs --check             # 只比对，不写入（有差异时退出码 1）
//   node scripts/ext-install.mjs --list              # 列出仓库里有哪些扩展
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const DEFAULT_DATA_ROOT = 'D:/AI/SillyTavern/Data';
export const REPO_EXT_DIR = 'extensions';

export function hashFile(f) { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12); }

export function listExtensions(repoRoot = process.cwd()) {
    const dir = path.join(repoRoot, REPO_EXT_DIR);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'manifest.json')))
        .map((e) => e.name);
}

function walk(dir, base = dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, base, out);
        else out.push(path.relative(base, p).split(path.sep).join('/'));
    }
    return out;
}

/**
 * 同步单个扩展。
 * @returns {{name:string,src:string,dst:string,rows:Array,stale:string[],manifest:object|null,changed:number}}
 */
export function syncExtension(name, opts = {}) {
    const repoRoot = opts.repoRoot || process.cwd();
    const dataRoot = opts.dataRoot || DEFAULT_DATA_ROOT;
    const dryRun = !!opts.dryRun;
    const check = !!opts.check;
    const log = opts.log || console.log;
    const src = path.join(repoRoot, REPO_EXT_DIR, name);
    const dst = path.join(dataRoot, 'default-user/extensions', name);
    if (!fs.existsSync(src)) throw new Error('源目录不存在: ' + src);

    const files = walk(src).sort();
    const rows = [];
    let changed = 0;
    for (const rel of files) {
        const from = path.join(src, rel);
        const to = path.join(dst, rel);
        const after = hashFile(from);
        const existed = fs.existsSync(to);
        const same = existed && hashFile(to) === after;
        let status = same ? 'unchanged' : (existed ? 'updated' : 'created');
        if (check) status = same ? 'ok' : 'differs';
        if (!same) changed++;
        if (!dryRun && !check && !same) {
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to);
        }
        rows.push({ file: rel, status, hash: after });
    }
    const stale = walk(dst).filter((rel) => !files.includes(rel)).sort();

    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')); } catch (e) { manifest = null; log('  ! manifest.json 无法解析: ' + e.message); }

    log((dryRun ? '[dry-run] ' : (check ? '[check] ' : '')) + '同步 ' + name + '  ' + src + '  ->  ' + dst);
    for (const r of rows) log('  ' + r.status.padEnd(9) + ' ' + r.file + '  (' + r.hash + ')');
    if (stale.length) log('  ' + 'stale(目标多余)'.padEnd(9) + ' ' + stale.join(', ') + '   （源里已删除，可手动清理）');
    if (manifest) log('  校验: manifest ✓ display_name=' + manifest.display_name + ' version=' + manifest.version + ' js=' + manifest.js + (manifest.css ? ' css=' + manifest.css : ''));
    return { name, src, dst, rows, stale, manifest, changed };
}

function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const check = args.includes('--check');
    const repoRoot = process.cwd();
    const all = listExtensions(repoRoot);
    if (args.includes('--list')) { console.log('仓库扩展: ' + (all.join(', ') || '(无)')); return; }
    const wanted = args.filter((a) => !a.startsWith('--'));
    const names = wanted.length ? wanted : all;
    if (!names.length) { console.error('没有找到可同步的扩展（extensions/<name>/manifest.json）'); process.exit(2); }
    let changed = 0;
    for (const n of names) {
        const r = syncExtension(n, { repoRoot, dryRun, check });
        changed += r.changed;
    }
    console.log((dryRun || check) ? ('差异文件数: ' + changed + (check && changed ? '（--check 存在差异，退出码 1）' : '')) : ('完成，共同步 ' + names.length + ' 个扩展，更新 ' + changed + ' 个文件'));
    if (check && changed) process.exit(1);
}

// 注意：Windows 下 import.meta.url 会对空格/中文做百分号编码，必须用 pathToFileURL 比，
// 之前写成字符串拼接导致 CLI 静默不执行（退出码还是 0）——已由 scripts/plot-pilot-test.mjs 之外的实测发现并修掉。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
