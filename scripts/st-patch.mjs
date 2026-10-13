// scripts/st-patch.mjs — ST 本体补丁集：查看 / 应用 / 回滚
//
// 为什么需要它：ST 本体是 git 仓库，**每次更新都会整体刷新** → 本目录 patches/*.patch
// 里的改动会被冲掉。所以「改本体」必须配一条可重放的路径，而不是手改。
//   「毁了重新适配」= 跑一次 `node scripts/st-patch.mjs --apply`
//
// 用法：
//   node scripts/st-patch.mjs                  # 只报状态（默认 --check）
//   node scripts/st-patch.mjs --apply          # 应用还没应用的
//   node scripts/st-patch.mjs --revert         # 回滚已应用的
//   node scripts/st-patch.mjs --st "D:/AI/SillyTavern/SillyTavern"
//
// 判定方式：补丁里插入的段落带唯一标记 `BEGIN sillytavern-shell patch #NNN`，
// 直接搜目标文件里有没有这个标记 —— 不依赖 git 状态，也不怕重复应用。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PATCH_DIR = path.join(REPO, 'patches');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const ST = val('--st', 'D:/AI/SillyTavern/SillyTavern');
const mode = flag('--apply') ? 'apply' : (flag('--revert') ? 'revert' : 'check');

if (!fs.existsSync(PATCH_DIR)) {
    console.log('没有 patches/ 目录，无事可做');
    process.exit(0);
}
if (!fs.existsSync(path.join(ST, 'package.json'))) {
    console.error('目标不像 ST 本体：' + ST);
    process.exit(2);
}

/** 从补丁文本里抽出：目标文件相对路径 + 标记串 */
function parsePatch(text) {
    const m = text.match(/^\+\+\+ b\/(.+)$/m);
    const rel = m ? m[1].trim() : null;
    const mk = text.match(/BEGIN sillytavern-shell patch #(\d+)/);
    const id = mk ? mk[1] : null;
    return { rel, id };
}

const files = fs.readdirSync(PATCH_DIR).filter(f => f.endsWith('.patch')).sort();
if (!files.length) { console.log('patches/ 里没有 .patch'); process.exit(0); }

let applied = 0, pending = 0, failed = 0;

for (const f of files) {
    const full = path.join(PATCH_DIR, f);
    const text = fs.readFileSync(full, 'utf8');
    const { rel, id } = parsePatch(text);

    if (!rel || !id) { console.log('  ✗ ' + f + '  补丁格式不对（缺 +++ b/ 头或标记串）'); failed++; continue; }

    const target = path.join(ST, rel);
    if (!fs.existsSync(target)) { console.log('  ✗ ' + f + '  目标文件不存在：' + rel); failed++; continue; }

    const marker = 'BEGIN sillytavern-shell patch #' + id;
    const isOn = fs.readFileSync(target, 'utf8').includes(marker);

    if (mode === 'check') {
        console.log('  ' + (isOn ? '✅ 已应用' : '⬜ 未应用') + '  #' + id + '  ' + f + '  →  ' + rel);
        isOn ? applied++ : pending++;
        continue;
    }

    if (mode === 'apply') {
        if (isOn) { console.log('  ⏭  跳过（已应用）  #' + id + '  ' + f); applied++; continue; }
        try {
            execFileSync('git', ['-C', ST, 'apply', '--verbose', full], { stdio: 'pipe' });
            console.log('  ✅ 已应用  #' + id + '  ' + f);
            applied++;
        } catch (e) {
            console.log('  ✗ 应用失败  #' + id + '  ' + f + '\n      ' + String(e.stderr || e.message).trim());
            failed++;
        }
        continue;
    }

    if (mode === 'revert') {
        if (!isOn) { console.log('  ⏭  跳过（未应用）  #' + id + '  ' + f); pending++; continue; }
        try {
            execFileSync('git', ['-C', ST, 'apply', '--reverse', '--verbose', full], { stdio: 'pipe' });
            console.log('  ✅ 已回滚  #' + id + '  ' + f);
            pending++;
        } catch (e) {
            console.log('  ✗ 回滚失败  #' + id + '  ' + f + '\n      ' + String(e.stderr || e.message).trim());
            failed++;
        }
    }
}

console.log('');
console.log('ST 本体目录：' + ST);
console.log('模式 ' + mode + '  →  已应用 ' + applied + ' / 未应用 ' + pending + ' / 失败 ' + failed);
process.exit(failed ? 1 : 0);
