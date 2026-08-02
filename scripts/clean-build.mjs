// clean-build.mjs — 构建前清理旧产物/旧缓存
// 用法:
//   node scripts/clean-build.mjs          # 清全部(dist + staging)
//   node scripts/clean-build.mjs full     # 只清完整版产物 + staging
//   node scripts/clean-build.mjs lite     # 只清轻量版产物(不碰完整版、不碰 staging 除非无缓存)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'all';

const DIRS = {
    full: ['staging', 'dist-electron', 'dist-electron-v3'],
    lite: ['dist-electron-lite', 'dist-electron-v3-lite'],
    all: ['staging', 'dist-electron', 'dist-electron-v3', 'dist-electron-v3-lite', 'dist-electron-lite', 'dist-electron-lite-tmp'],
};

// 旧安装包文件(只清匹配当前模式的)
const FILES = {
    full: ['SillyTavern-Setup-*.exe', 'SillyTavern-Setup-*.exe.blockmap'],
    lite: ['SillyTavern-Lite-Setup-*.exe', 'SillyTavern-Lite-Setup-*.exe.blockmap'],
    all: ['SillyTavern-Setup-*.exe', 'SillyTavern-Lite-Setup-*.exe', 'SillyTavern-Setup-*.exe.blockmap', 'SillyTavern-Lite-Setup-*.exe.blockmap', 'latest.yml'],
};

if (!DIRS[mode]) {
    console.error(`Unknown mode: ${mode} (use: all | full | lite)`);
    process.exit(1);
}

let removed = 0;
for (const d of DIRS[mode]) {
    const p = path.join(ROOT, d);
    if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        console.log(`[clean:${mode}] removed dir: ${d}`);
        removed++;
    }
}

for (const f of FILES[mode]) {
    const re = new RegExp('^' + f.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    for (const name of fs.readdirSync(ROOT)) {
        if (re.test(name)) {
            fs.rmSync(path.join(ROOT, name), { force: true });
            console.log(`[clean:${mode}] removed file: ${name}`);
            removed++;
        }
    }
}

console.log(`\n[clean:${mode}] complete. ${removed} items removed.`);
