// scripts/cine-preset.mjs — 生成/更新「分镜对话」专属预设
//
// 为什么要有这个脚本：专属预设是**派生文件**（原版预设的副本 + 分镜改动）。
// 手改副本的问题：① 原版更新后要重做；② 改了什么没人记得；③ 容易漏。
// 所以把「差分」写死在脚本里，**可重复执行、幂等**，随时能从原版重新生成。
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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT_SPEC } from '../extensions/cine-dialogue/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = 'D:/AI/SillyTavern/Data/default-user/OpenAI Settings';
const DEFAULT_SRC = path.join(DEFAULT_DIR, 'Izumi 0828.tailfree.json');
const DEFAULT_OUT = path.join(DEFAULT_DIR, 'Izumi 0828.tailfree + 分镜.json');

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const check = args.includes('--check');

const SRC = val('--src', DEFAULT_SRC);
const OUT = val('--out', DEFAULT_OUT);
const PROMPT_NAME = '【分镜】正文行格式';
const THINKING_DEPTH = 20;          // 原版是 2，太浅 → 往上的楼思考全裸露
const TALKING_RE = /思维链/;         // 思维链美化那几条正则

if (!fs.existsSync(SRC)) {
    console.error('原版预设不存在：' + SRC);
    process.exit(2);
}
const orig = JSON.parse(fs.readFileSync(SRC, 'utf8'));
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

// ---------------------------------------------------------------- 写盘
console.log('原版: ' + SRC);
console.log('专属: ' + OUT);
console.log('');
for (const c of changes) console.log('  · ' + c);
console.log('');
console.log('prompts ' + (orig.prompts || []).length + ' → ' + out.prompts.length
    + '   order ' + ((orig.prompt_order?.[0]?.order) || []).length + ' → ' + order.length);

if (check) {
    console.log('');
    console.log('--check：没有写文件');
    process.exit(0);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 4), 'utf8');
console.log('');
console.log('已写入：' + OUT + '（' + Math.round(fs.statSync(OUT).size / 1024) + ' KB）');
