// scripts/ext-index.mjs — 生成 extensions/index.json（内置扩展的「在线更新清单」）
// 用途：套壳除了安装包自带的那份，还能按这份清单从 CDN 拉取更新的扩展版本 →
//       扩展更新不必再等整个套壳发版（版本解耦）。
// 用法：
//   node scripts/ext-index.mjs            # 生成/覆盖 extensions/index.json
//   node scripts/ext-index.mjs --check    # 只校验（内容与清单不一致时退出码 1，CI/夹具用）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { listBundled, walkFiles } from '../lib/ext-deploy.js';

export const INDEX_FILE = 'index.json';
export const REPO = 'Anarrogantcat/sillytavern-shell';

function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }

/** 二进制资源（将来扩展带图片/字体/音频时用；按字节哈希，不做行尾归一） */
const BIN_EXT = /.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|otf|eot|mp3|ogg|wav|mp4|webm|zip|gz|pdf|bin)$/i;
export function isBinaryPath(rel) { return BIN_EXT.test(String(rel || '')); }

/** 生成清单对象（不含 generatedAt 之外的随机性，保证可复现） */
export function buildIndex(repoRoot = process.cwd()) {
    const root = path.join(repoRoot, 'extensions');
    const extensions = listBundled(root).map((item) => {
        const files = walkFiles(item.srcDir).sort().map((rel) => {
            const raw = fs.readFileSync(path.join(item.srcDir, rel));
            if (isBinaryPath(rel)) return { path: rel, size: raw.length, sha1: sha1(raw), bin: true };
            // 文本：与在线侧一致，先把 CRLF 归一成 LF 再算哈希（Windows 工作区 vs CDN 的 LF）
            const norm = Buffer.from(raw.toString('utf8').split('\r\n').join('\n'), 'utf8');
            return { path: rel, size: norm.length, sha1: sha1(norm) };
        });
        return { id: item.id, display_name: item.displayName, version: item.version, files };
    });
    return { schema: 1, repo: REPO, base: 'extensions', extensions };
}

/** 只比较「扩展 id/version/文件哈希」这些会变的部分，忽略 generatedAt */
export function coreOf(index) {
    return JSON.stringify((index.extensions || []).map((e) => ({ id: e.id, v: e.version, f: e.files.map((x) => x.path + ':' + x.sha1) })));
}

function main() {
    const repoRoot = process.cwd();
    const check = process.argv.includes('--check');
    const file = path.join(repoRoot, 'extensions', INDEX_FILE);
    const next = buildIndex(repoRoot);
    if (check) {
        if (!fs.existsSync(file)) { console.error('缺少 extensions/index.json（跑 node scripts/ext-index.mjs 生成）'); process.exit(1); }
        const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (coreOf(cur) !== coreOf(next)) {
            console.log('extensions/index.json 与当前扩展内容不一致 —— 改了扩展就要重新生成清单（node scripts/ext-index.mjs）');
            console.error('index.json STALE');
            process.exit(1);
        }
        console.log('extensions/index.json 校验通过（' + next.extensions.length + ' 个扩展）');
        return;
    }
    next.generatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
    console.log('已生成 extensions/index.json：');
    for (const e of next.extensions) console.log('  ' + e.id.padEnd(14) + ' v' + e.version + '  ' + e.files.length + ' 个文件');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
