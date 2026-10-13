// scripts/cine-preset.mjs — 生成/更新「分镜对话」专属预设（CLI）
//
// 配方本体在 **扩展里**（`extensions/cine-dialogue/logic.js` 的 `applyPresetRecipe`）——
// 扩展面板的「生成专属预设」按钮与本脚本调的是**同一份实现**，不存在两处配方漂移。
// 本脚本只负责：读文件 → 调配方 → 写文件 → 报告。
//
// ⚠️ 版权与分发（照抄原预设自带说明，不许改写）：
//     作者：泉此方
//     可以二改，禁止二传，拿功能要先问我，署名
//     来源：Lucky Channel https://discord.gg/xXNWRDhZKP（仅在类脑社区与 Lucky Channel 免费发布）
//   ⇒ 因此：**派生出的预设文件只留在本地，绝不能进仓库、绝不能分发**。
//      本仓库里只有这份"差分配方"，不含预设本体（夹具里有断言把这条锁住）。
//
// 用法：
//   npm run preset:cine                       # 就地更新（用默认路径）
//   node scripts/cine-preset.mjs --check      # 只报差异，不写文件
//   node scripts/cine-preset.mjs --src X.json --out Y.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyPresetRecipe, PRESET_UPSTREAM } from '../extensions/cine-dialogue/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = 'D:/AI/SillyTavern/Data/default-user/OpenAI Settings';
const DEFAULT_SRC = path.join(DEFAULT_DIR, 'Izumi 0828.tailfree.json');
const DEFAULT_OUT = path.join(DEFAULT_DIR, 'Izumi 0828 + 分镜对话（专属适配）.json');

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const check = args.includes('--check');

const SRC = val('--src', DEFAULT_SRC);
const OUT = val('--out', DEFAULT_OUT);

if (!fs.existsSync(SRC)) {
    console.error('原版预设不存在：' + SRC);
    process.exit(2);
}
const srcBuf = fs.readFileSync(SRC);
const srcHash = crypto.createHash('sha256').update(srcBuf).digest('hex');
const orig = JSON.parse(srcBuf.toString('utf8'));

/* 关键：**以磁盘上现有的派生文件为基础**再套配方（而不是每次从原版重做），
   这样用户在派生文件里自己做的额外调整不会被抹掉。 */
const base = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : orig;
const r = applyPresetRecipe(base, { srcName: path.basename(SRC), srcHash });
if (!r.ok) {
    console.error('配方失败：' + r.changes.join('；'));
    process.exit(1);
}

console.log('原版: ' + SRC);
console.log('       sha256 ' + srcHash.slice(0, 24) + '…');
console.log('专属: ' + OUT);
console.log('');
console.log('原作者：' + PRESET_UPSTREAM.author + '　许可：' + PRESET_UPSTREAM.license);
console.log('');
for (const c of r.changes) console.log('  · ' + c);
console.log('');
console.log('prompts ' + r.stats.promptsFrom + ' → ' + r.stats.promptsTo
    + '   order ' + r.stats.orderFrom + ' → ' + r.stats.orderTo
    + '   （其中启用 ' + r.stats.enabledTo + ' 条）');

if (check) {
    console.log('');
    console.log('--check：没有写文件');
    process.exit(0);
}
fs.writeFileSync(OUT, JSON.stringify(r.preset, null, 4), 'utf8');
console.log('');
console.log('已写入：' + OUT + '（' + Math.round(fs.statSync(OUT).size / 1024) + ' KB）');
console.log('⚠️ 原预设许可要求「禁止二传」—— 这个派生文件只留在本地，不要分发。');
