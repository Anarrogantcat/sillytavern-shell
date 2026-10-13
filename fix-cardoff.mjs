// §1.6 规范补丁：逐卡「本卡不生效」
// 思路：只在 effectiveConfig() 一个点上把 off 翻成 enabled:false ⇒ 所有已有的 enabled 检查点自动生效
import fs from 'node:fs';

const I = 'extensions/cine-dialogue/index.js';
const before = fs.readFileSync(I, 'utf8');
let s = before;
const log = [];

// ---------------------------------------------------------------- ① effectiveConfig：唯一的开关点
const A1 = `    if (!key || !base.perCard || !base.perCard[key]) return base;
    return { ...base, ...base.perCard[key] };`;
const n1 = s.split(A1).length - 1;
if (n1 !== 1) { console.error('✗ ① 锚点命中 ' + n1 + ' 次（应为 1）'); process.exit(1); }
s = s.replace(A1, () => [
    '    if (!key || !base.perCard || !base.perCard[key]) return base;',
    '    const merged = { ...base, ...base.perCard[key] };',
    '    /* ★★ 逐卡「本卡不生效」（面板里那个按钮）：在这里把它翻成 enabled:false。',
    '       为什么只在这一个点做：**所有**已有的 enabled 检查点（渲染钩子 / run / 提示词注入 /',
    '       Alt+↑↓ / 宽表格处理 / 交互绑定 / 恢复原文）都会自动跟着失效，不必逐处再加判断 ✓',
    '       —— 卡自带美化的时候，你按一下这个按钮，插件对**这张卡**就完全不动作了。 */',
    '    if (merged.off) return { ...merged, enabled: false, off: true };',
    '    return merged;',
].join('\n'));
log.push('① effectiveConfig 增加逐卡 off（命中 ' + n1 + '）');

// ---------------------------------------------------------------- ② 面板按钮
const A2 = `'          <button type="button" class="menu_button" id="cd-card-clear">清除这张卡的配置</button>',`;
const n2 = s.split(A2).length - 1;
if (n2 !== 1) { console.error('✗ ② 锚点命中 ' + n2 + ' 次（应为 1）'); process.exit(1); }
s = s.replace(A2, () => [
    A2,
    "          '<button type=\"button\" class=\"menu_button\" id=\"cd-card-off\">这张卡不生效（自带美化的卡用它）</button>',",
].join('\n'));
log.push('② 加了按钮 #cd-card-off（命中 ' + n2 + '）');

// ---------------------------------------------------------------- ③ 动作处理
const A3 = `            case 'cd-card-clear': {`;
const n3 = s.split(A3).length - 1;
if (n3 !== 1) { console.error('✗ ③ 锚点命中 ' + n3 + ' 次（应为 1）'); process.exit(1); }
s = s.replace(A3, () => [
    "            /* ★ 逐卡「本卡不生效」：切换 off。",
    "               只动 off 这一个键 —— 这张卡其它的专属配置（颜色/层样式…）原样保留 ✓ */",
    "            case 'cd-card-off': {",
    '                const kOff = cardKey();',
    "                if (!kOff) { notify('没有加载角色卡 → 逐卡设置不可用', 'error'); return; }",
    '                const cOff = cfg();',
    '                const pcOff = { ...(cOff.perCard || {}) };',
    '                const cur = { ...(pcOff[kOff] || {}) };',
    '                if (cur.off) {',
    '                    delete cur.off;',
    '                    if (Object.keys(cur).length) pcOff[kOff] = cur; else delete pcOff[kOff];',
    "                    notify('已恢复：这张卡重新生效', 'success');",
    '                } else {',
    '                    cur.off = true;',
    '                    pcOff[kOff] = cur;',
    "                    notify('已设为「这张卡不生效」：插件对这张卡完全不动作（其它卡不受影响）', 'success');",
    '                }',
    '                cOff.perCard = pcOff;',
    '                saveSettingsDebounced();',
    '                rebuildDynamic();',
    '                restoreAllMessages();',
    '                return;',
    '            }',
    A3,
].join('\n'));
log.push('③ 动作 cd-card-off（命中 ' + n3 + '）');

// ---------------------------------------------------------------- ④ 状态行：不生效时要显眼
const A4 = `        const has = !!(k && c.perCard && c.perCard[k]);`;
const n4 = s.split(A4).length - 1;
if (n4 !== 1) { console.error('✗ ④ 锚点命中 ' + n4 + ' 次（应为 1）'); process.exit(1); }
s = s.replace(A4, () => [
    '        const has = !!(k && c.perCard && c.perCard[k]);',
    "        const isOff = !!(k && c.perCard && c.perCard[k] && c.perCard[k].off);",
].join('\n'));
log.push('④-a 状态行加 isOff（命中 ' + n4 + '）');

const A5 = `            ? ('当前卡：' + k + (has ? ' —— 已有专属配置（覆盖全局）' : ' —— 没有专属配置，用全局设置'))`;
const n5 = s.split(A5).length - 1;
if (n5 !== 1) { console.error('✗ ⑤ 锚点命中 ' + n5 + ' 次（应为 1）'); process.exit(1); }
s = s.replace(A5, () => [
    "            ? (isOff",
    "                ? ('⛔ 当前卡：' + k + ' —— 已设为「不生效」，插件对这张卡完全不动作（再按一次按钮可恢复）')",
    "                : ('当前卡：' + k + (has ? ' —— 已有专属配置（覆盖全局）' : ' —— 没有专属配置，用全局设置')))",
].join('\n'));
log.push('④-b 状态行显示 ⛔（命中 ' + n5 + '）');

// ---------------------------------------------------------------- ⑤ diagnose 报告
const A6 = `        hook: hookActive(),`;
const n6 = s.split(A6).length - 1;
if (n6 !== 1) { console.error('✗ ⑥ 锚点命中 ' + n6 + ' 次（应为 1）'); process.exit(1); }
s = s.replace(A6, () => [
    '        hook: hookActive(),',
    '        /* 逐卡「不生效」—— 报出来，免得你以为插件坏了 */',
    "        cardOff: { off: !!effectiveConfig().off, card: cardKey() || '(无)' },",
].join('\n'));
log.push('⑤ diagnose 增加 cardOff（命中 ' + n6 + '）');

if (s === before) { console.error('✗ 什么都没改'); process.exit(1); }
fs.writeFileSync(I, s, 'utf8');
log.forEach((x) => console.log(x));
console.log('已写盘');
