// scripts/cine-preset.mjs — 生成/更新「分镜对话」专属预设
//
// 为什么要有这个脚本：专属预设是**派生文件**（原版预设的副本 + 分镜改动）。
// 手改副本的问题：① 原版更新后要重做；② 改了什么没人记得；③ 容易漏。
// 所以把「差分」写死在脚本里，**可重复执行、幂等**，随时能从原版重新生成。
//
// ⚠️ 版权与分发（照抄原预设自带说明，不许改写）：
//     作者：泉此方
//     可以二改，禁止二传，拿功能要先问我，署名
//     来源：Lucky Channel https://discord.gg/xXNWRDhZKP（仅在类脑社区与 Lucky Channel 免费发布）
//   ⇒ 因此：**派生出的预设文件只留在本地，绝不能进仓库、绝不能分发**。
//      本仓库里只有这份"差分配方"，不含预设本体（夹具里有断言把这条锁住）。
//
// 用法：
//   node scripts/cine-preset.mjs                       # 就地更新（用默认路径）
//   node scripts/cine-preset.mjs --check               # 只报差异，不写文件
//   node scripts/cine-preset.mjs --src X.json --out Y.json
//
// 差分（相对原版预设 `Izumi 0828.tailfree.json`）：
//   ① 新增提示条目「【分镜】正文行格式」（内容来自扩展的 FORMAT_SPEC —— **唯一权威文本**），
//      插进 prompt_order 并启用
//   ② 👤人称-第三人称 启用 / 👤人称-User第一人称 停用
//   ③ 🚢文风-顺眼舒服 停用
//   ④ **思维链美化正则的最大深度 2 → 20**
//      ← 必须修：`maxDepth: 2` 意味着「只美化最近 2 层」，往上翻的楼思考原样裸露
//        （真机反馈：「上面的思考没隐藏」）。这是专属预设自己的问题，不能推给插件兜底。
//   ⑤ 写入**出处与许可**：`extensions.cine_dialogue.derivedFrom`（机器可读）
//      + 一条**停用**的提示条目「📋分镜派生说明（勿启用）」（人可读，在预设界面里能看见）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FORMAT_SPEC } from '../extensions/cine-dialogue/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = 'D:/AI/SillyTavern/Data/default-user/OpenAI Settings';
const DEFAULT_SRC = path.join(DEFAULT_DIR, 'Izumi 0828.tailfree.json');
const DEFAULT_OUT = path.join(DEFAULT_DIR, 'Izumi 0828.tailfree + 分镜.json');

/* 原预设自带的署名与许可 —— **逐字照抄**，不改写、不简化 */
const UPSTREAM = {
    author: '泉此方',
    license: '可以二改，禁止二传，拿功能要先问我，署名',
    source: 'Lucky Channel https://discord.gg/xXNWRDhZKP（仅在类脑社区与 Lucky Channel 免费发布）',
};

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const check = args.includes('--check');

const SRC = val('--src', DEFAULT_SRC);
const OUT = val('--out', DEFAULT_OUT);
const PROMPT_NAME = '【分镜】正文行格式';
const NOTE_NAME = '📋分镜派生说明（勿启用）';
const THINKING_DEPTH = 20;          // 原版是 2，太浅 → 往上的楼思考全裸露
const TALKING_RE = /思维链/;         // 思维链美化那几条正则

if (!fs.existsSync(SRC)) {
    console.error('原版预设不存在：' + SRC);
    process.exit(2);
}
const srcBuf = fs.readFileSync(SRC);
const srcHash = crypto.createHash('sha256').update(srcBuf).digest('hex');
const orig = JSON.parse(srcBuf.toString('utf8'));
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : JSON.parse(JSON.stringify(orig));

const changes = [];

// ---------------------------------------------------------------- ① 格式说明条目
out.prompts = out.prompts || [];
let p = out.prompts.find(x => String(x.name || '') === PROMPT_NAME);
if (!p) {
    p = { identifier: 'cine-dialogue-format', name: PROMPT_NAME, system_prompt: true, role: 'system', content: FORMAT_SPEC, injection_position: 0, injection_depth: 4 };
    out.prompts.push(p);
    changes.push('新增提示条目「' + PROMPT_NAME + '」（' + FORMAT_SPEC.length + ' 字）');
} else {
    changes.push('提示条目「' + PROMPT_NAME + '」已存在（内容 ' + String(p.content || '').length + ' 字，保持不动）');
}
if (!Array.isArray(out.prompt_order) || !out.prompt_order.length) out.prompt_order = [{ character_id: 100000, order: [] }];
const order = out.prompt_order[0].order = out.prompt_order[0].order || [];
let entry = order.find(o => String(o.identifier) === String(p.identifier));
if (!entry) {
    entry = { identifier: p.identifier, enabled: true };
    const at = Math.min(143, order.length);
    order.splice(at, 0, entry);
    changes.push('插入 prompt_order[' + at + ']，启用');
} else if (entry.enabled !== true) {
    entry.enabled = true;
    changes.push('prompt_order 里改为启用');
} else {
    changes.push('prompt_order 已启用（位置 ' + order.indexOf(entry) + '）');
}

// ---------------------------------------------------------------- ②③ 两处开关
const wantToggle = { '👤人称-第三人称': true, '👤人称-User第一人称': false, '🚢文风-顺眼舒服': false };
for (const [name, want] of Object.entries(wantToggle)) {
    const pr = out.prompts.find(x => String(x.name || '') === name);
    if (!pr) { changes.push('⚠ 找不到条目「' + name + '」→ 跳过'); continue; }
    const e = order.find(o => String(o.identifier) === String(pr.identifier));
    if (!e) { changes.push('⚠ 「' + name + '」不在 prompt_order 里 → 跳过'); continue; }
    if (e.enabled !== want) {
        changes.push('「' + name + '」 ' + e.enabled + ' → ' + want);
        e.enabled = want;
    } else {
        changes.push('「' + name + '」 已是 ' + want);
    }
}

// ---------------------------------------------------------------- ④ 思维链正则的深度
const scripts = (out.extensions && out.extensions.regex_scripts) || [];
let touched = 0;
for (const s of scripts) {
    const nm = String(s.scriptName || '');
    if (!TALKING_RE.test(nm)) continue;
    const isOn = !s.disabled;
    if (!isOn) { changes.push('思维链正则「' + nm + '」是关的 → 跳过'); continue; }
    if (s.maxDepth !== THINKING_DEPTH) {
        changes.push('思维链正则「' + nm + '」 maxDepth ' + s.maxDepth + ' → ' + THINKING_DEPTH);
        s.maxDepth = THINKING_DEPTH;
        touched++;
    } else {
        changes.push('思维链正则「' + nm + '」 maxDepth 已是 ' + THINKING_DEPTH);
    }
}
if (!touched && !changes.some(c => c.includes('maxDepth'))) {
    changes.push('⚠ 没找到开启中的思维链正则（预设结构可能变了）');
}

// ---------------------------------------------------------------- ⑤ 出处 + 许可（署名）
out.extensions = out.extensions || {};
out.extensions.cine_dialogue = {
    kind: 'derived-preset',
    derivedFrom: { file: path.basename(SRC), sha256: srcHash },
    upstream: { author: UPSTREAM.author, license: UPSTREAM.license, source: UPSTREAM.source },
    generator: 'sillytavern-shell/scripts/cine-preset.mjs',
    note: '本地派生副本：给「分镜对话 Cine Dialogue」扩展配套用。'
        + '原预设许可为「' + UPSTREAM.license + '」，**本文件不得二传/分发**。',
    changes: [
        '新增提示条目「' + PROMPT_NAME + '」并启用',
        '👤人称-第三人称 开 / 👤人称-User第一人称 关',
        '🚢文风-顺眼舒服 关',
        '思维链美化正则 maxDepth 2 → ' + THINKING_DEPTH,
    ],
};
changes.push('写入出处与许可（作者：' + UPSTREAM.author + '；' + UPSTREAM.license + '）');

/* 人可读的那份：做成**停用**的提示条目 —— 在预设界面里看得见，但永远不进提示词 */
const noteText = [
    '{{//',
    '【分镜派生说明】这份预设是从原版派生出来的**本地副本**，不是原作者的发布版。',
    '',
    '原预设作者：' + UPSTREAM.author,
    '原预设许可：' + UPSTREAM.license,
    '原预设来源：' + UPSTREAM.source,
    '派生自：' + path.basename(SRC) + '（sha256 ' + srcHash.slice(0, 16) + '…）',
    '',
    '派生改动（由 sillytavern-shell/scripts/cine-preset.mjs 生成，可重放）：',
    '  1. 新增提示条目「' + PROMPT_NAME + '」并启用（教模型按 `名字·层 内容` 写）',
    '  2. 👤人称-第三人称 开 / 👤人称-User第一人称 关',
    '  3. 🚢文风-顺眼舒服 关',
    '  4. 思维链美化正则的最大深度 2 → ' + THINKING_DEPTH + '（原为 2，往上翻的楼思考会裸露）',
    '',
    '⚠️ 本条目**保持停用**，只是留个说明，不要启用。',
    '⚠️ 原预设禁止二传 —— **这个派生文件不要分发给任何人**。',
    '}}',
].join('\n');
let note = out.prompts.find(x => String(x.name || '') === NOTE_NAME);
if (!note) {
    note = { identifier: 'cine-dialogue-provenance', name: NOTE_NAME, system_prompt: false, role: 'system', content: noteText };
    out.prompts.push(note);
    changes.push('新增（停用的）「' + NOTE_NAME + '」条目');
} else {
    note.content = noteText;
    changes.push('更新「' + NOTE_NAME + '」条目（已在）');
}
let noteEntry = order.find(o => String(o.identifier) === String(note.identifier));
if (!noteEntry) {
    noteEntry = { identifier: note.identifier, enabled: false };
    order.push(noteEntry);
    changes.push('把说明条目挂进 prompt_order（**停用**）');
} else if (noteEntry.enabled !== false) {
    noteEntry.enabled = false;
    changes.push('说明条目改为停用（它只用来留痕，不能进提示词）');
} else {
    changes.push('说明条目已是停用状态');
}

// ---------------------------------------------------------------- 写盘
console.log('原版: ' + SRC);
console.log('       sha256 ' + srcHash.slice(0, 24) + '…');
console.log('专属: ' + OUT);
console.log('');
for (const c of changes) console.log('  · ' + c);
console.log('');
console.log('prompts ' + (orig.prompts || []).length + ' → ' + out.prompts.length
    + '   order ' + ((orig.prompt_order?.[0]?.order) || []).length + ' → ' + order.length
    + '   （其中启用 ' + order.filter(o => o.enabled).length + ' 条）');

if (check) {
    console.log('');
    console.log('--check：没有写文件');
    process.exit(0);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 4), 'utf8');
console.log('');
console.log('已写入：' + OUT + '（' + Math.round(fs.statSync(OUT).size / 1024) + ' KB）');
console.log('⚠️ 原预设许可要求「禁止二传」—— 这个派生文件只留在本地，不要分发。');
