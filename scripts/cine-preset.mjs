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
/* ★ 文件名带版本（用户要求「加版本号」）—— 版本从 logic.js 的 VERSION 取 ⇒ 升版本即改名 ✓ */
function versionedOutName() {
    try {
        const src = fs.readFileSync(path.join(__dirname, '..', 'extensions', 'cine-dialogue', 'logic.js'), 'utf8');
        const mm = src.match(/export const VERSION = '([^']+)'/);
        if (mm) return '分镜对话（专属适配）v' + mm[1] + '.json';
    } catch (_) { }
    return '分镜对话（专属适配）.json';
}
const DEFAULT_OUT = path.join(DEFAULT_DIR, versionedOutName());

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const check = args.includes('--check');
/* ★★ 1.4.0：--clean = 从零构建的「干净版」
   底稿换成 **SillyTavern 官方默认预设**（不含任何第三方预设内容）
   输出到另一个文件名，两份预设并存（派生的那份继续保留） */
const clean = args.includes('--clean');

const ST_DEFAULT = path.join(DEFAULT_DIR, 'Default.json');
function cleanOutName() {
    try {
        const src = fs.readFileSync(path.join(__dirname, '..', 'extensions', 'cine-dialogue', 'logic.js'), 'utf8');
        const mm = src.match(/export const VERSION = '([^']+)'/);
        /* ★ 1.6.0 C3：干净版正名为「通用版」—— 一份预设走天下 ✓ */
        if (mm) return '分镜对话（通用版）v' + mm[1] + '.json';
    } catch (_) { }
    return '分镜对话（通用版）.json';
}

const SRC = val('--src', clean ? ST_DEFAULT : DEFAULT_SRC);
const OUT = val('--out', clean ? path.join(DEFAULT_DIR, cleanOutName()) : DEFAULT_OUT);
/* ★★ 1.6.0（C3）：--merge-from <预设文件> —— 把那份预设里的"卡前端支撑条目"合并进通用版
   用途：某些卡的状态栏 / 选项栏 / MVU 变量更新，靠的是**卡配套预设**里的条目 ✗
        与其换卡就换预设，不如把那些条目**并进通用版** ⇒ 一份预设走天下 ✓
   判据（保守，只搬明显是前端支撑的）：
     · 条目内容里出现 <StatusPlaceHolderImpl/> / <option/> / <StatusBar> / TavernHelper / UpdateVariable / <%
     · 或名字里出现 状态栏 / 选项 / 前端 / MVU / 变量更新 / stat
   只搬目标里**还没有**的（按名字去重 ✓），并保持原启用状态 ✓ */
const MERGE_FROM = val('--merge-from', '');

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
const r = applyPresetRecipe(base, { srcName: path.basename(SRC), srcHash, clean });

/* ★★ 1.5.0：干净版还要带上用户**点名**的那些条目（2026-10-14「这些加上」）
   它们属于上游预设的"素材库"（NSFW / 文风），从**上游预设**按名字搬过来 ✓
   · 保持**原启用状态**（下游想用就自己开）✓
   · 只搬条目本体 + 在 prompt_order 里挂位（已存在就跳过）✓
   · 搬运来源固定是 DEFAULT_SRC（Izumi），与 --src 无关，避免把 ST 默认预设当素材 ✗ */
const CLEAN_EXTRA_NAMES = [
    '🎁可写NSFW↓',
    'nsfw-体型差色色',
    'nsfw-木珠',
    '✔️多人称文风-王小波',
    '实验-nsfw',
    'NSFW-本子-实验',
    '实验-ASMR',
    '❄️男性向-直白色情',
    '❄️NSFW-谷崎润一郎',
    '✔️文风-广播剧（点进去）',
    '广播剧nsfw配件',
    '✔️文风-男性视觉（感谢k一串）',
    '🔴NSFW加强',
    /* ★ 1.5.2：用户第二批点名（2026-10-14「这些」） */
    '⭐思维链语言-中文',
    '涩涩加速',
    '防重复上文',
    '结尾协议（顺序固定）',
    '结尾完整性（最高优先级）',
    '不许语气描写',
    '推剧情',
];
if (clean && r.ok) {
    let pool = null;
    try { pool = JSON.parse(fs.readFileSync(DEFAULT_SRC, 'utf8')); } catch (_) { }
    if (!pool) {
        console.log('⚠ 找不到素材来源（' + DEFAULT_SRC + '）⇒ 跳过追加条目');
    } else {
        const poolP = pool.prompts || [];
        const poolO = ((pool.prompt_order || [])[0] || {}).order || [];
        const poolEn = new Map(poolO.map((x) => [String(x.identifier), !!x.enabled]));
        const P = r.preset.prompts = r.preset.prompts || [];
        const O = r.preset.prompt_order[0].order;
        let added = 0, on = 0;
        /* ★ 1.5.2：**去掉 emoji / 变体选择符 / 空白后再精确比对** ✓
           教训（两条，都是本会话踩到的）：
           ① 上游条目带 emoji 前缀（🎆/🎇/😍/⛔️…），用户截图里 emoji 不显示 ⇒ 全名匹配会漏 ✗
           ② 但**包含匹配又太松** ✗：`⚡推剧情` 会匹配到 `⚡️慢推剧情`（两个不同条目！）
           ③ 还有**变体选择符**坑：`⭐思维链语言-中文` 的真实名字是 `⭐️思维链语言-中文`（多了 U+FE0F）
           ⇒ 正解：两侧都剥掉 emoji 区间与 U+FE0F 与空白，再**精确**比较 ✓ */
        const normName = (s) => String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}\s]/gu, '');
        for (const nm of CLEAN_EXTRA_NAMES) {
            const src = poolP.find((x) => normName(x.name) === normName(nm));
            if (!src) { console.log('  · ⚠ 素材里没有「' + nm + '」⇒ 跳过'); continue; }
            const realName = String(src.name || '').trim();
            if (P.some((x) => String(x.name || '').trim() === realName)) { console.log('  · 「' + realName + '」已在干净版里 ⇒ 跳过'); continue; }
            const copy = JSON.parse(JSON.stringify(src));
            P.push(copy);
            const wantOn = poolEn.get(String(src.identifier)) === true;
            O.push({ identifier: copy.identifier, enabled: wantOn });
            added++;
            if (wantOn) on++;
            console.log('  · 追加「' + realName + '」（' + (wantOn ? '启用' : '停用') + '，' + String(copy.content || '').length + ' 字）');
        }
        console.log('');
        console.log('干净版追加素材条目 ' + added + ' 条（其中启用 ' + on + ' 条）');
    }
}

/* ★★ 1.6.0（C3）：--merge-from —— 把某份预设里的"卡前端支撑条目"并进本预设 ✓ */
if (MERGE_FROM && r.ok) {
    const FE_CONTENT = /StatusPlaceHolderImpl|<option\s*\/?>|<StatusBar>|TavernHelper|UpdateVariable|<%|getVariables|replaceVariables|Mvu|stat_data/i;
    const FE_NAME = /状态栏|选项|前端|界面|面板|MVU|变量更新|变量|stat/i;
    const p2 = path.isAbsolute(MERGE_FROM) ? MERGE_FROM : path.join(DEFAULT_DIR, MERGE_FROM);
    console.log('');
    console.log('=== --merge-from：从「' + path.basename(p2) + '」并入卡前端支撑条目 ===');
    if (!fs.existsSync(p2)) {
        console.log('  ⚠ 找不到 ' + p2 + ' ⇒ 跳过');
    } else {
        const mp = JSON.parse(fs.readFileSync(p2, 'utf8'));
        const mpP = mp.prompts || [];
        const mpO = ((mp.prompt_order || [])[0] || {}).order || [];
        const mpEn = new Map(mpO.map((x) => [String(x.identifier), !!x.enabled]));
        const P = r.preset.prompts = r.preset.prompts || [];
        const O = r.preset.prompt_order[0].order;
        const have = new Set(P.map((x) => String(x.name || '').trim()));
        let got = 0, gotOn = 0;
        for (const sp of mpP) {
            const nm = String(sp.name || '').trim();
            const c = String(sp.content || '');
            if (!nm) continue;
            if (!FE_CONTENT.test(c) && !FE_NAME.test(nm)) continue;
            if (have.has(nm)) continue;
            const copy = JSON.parse(JSON.stringify(sp));
            P.push(copy);
            const wantOn = mpEn.get(String(sp.identifier)) === true;
            O.push({ identifier: copy.identifier, enabled: wantOn });
            have.add(nm);
            got++;
            if (wantOn) gotOn++;
            console.log('  · 并入「' + nm.slice(0, 26) + '」（' + (wantOn ? '启用' : '停用') + '，' + c.length + ' 字）');
        }
        console.log('  ⇒ 并入 ' + got + ' 条（其中启用 ' + gotOn + ' 条）');
        if (!got) console.log('  （没有可并入的 —— 要么来源里没有，要么本预设已经有了 ✓）');
    }
}
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
if (clean) {
    console.log('✓ 干净版：底稿是 SillyTavern 官方默认预设 ⇒ 不含任何第三方预设内容，可自由分发 ✓');
    console.log('⚠️ 代价：不含角色卡自带的前端条目 ⇒ 若状态栏 / 选项栏不出现，请改用「专属适配」那份 ✓');
} else {
    console.log('⚠️ 原预设许可要求「禁止二传」—— 这个派生文件只留在本地，不要分发。');
}
