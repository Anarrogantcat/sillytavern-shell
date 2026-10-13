// 提交 + 推送 + 部署 + 自检
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const R = 'D:/AI/DeepSeek Harness Workspace/sillytavern-shell';
process.chdir(R);

const MSG = `feat(cine-dialogue): 0.8.9 —— 逐卡「本卡不生效」（给自带美化的卡用）

用户问题：「插件能不能在遇到本身有美化的角色卡不生效」

先说清前提：插件无法自动判断"这张卡有没有自带美化"（有 CSS？有脚本？有状态栏？都不可靠），
猜错会让本该生效的卡不生效，比不做更糟。所以采用显式标记：面板里按一下按钮即可。

做了什么：面板「逐卡配置」区新增按钮「这张卡不生效（自带美化的卡用它）」，
按一下写进本卡的 perCard[卡].off。

★ 实现只在一个点上（关键）：effectiveConfig() 里
    if (merged.off) return { ...merged, enabled: false, off: true };
  ⇒ 所有已有的 enabled 检查点自动全部失效，不必逐处再加判断：
    渲染钩子 / run() / 提示词注入 / Alt+↑↓ / 宽表格处理 / 交互绑定 / 恢复原文 全都覆盖。

其它：切换只动 off 这一个键（这张卡的颜色/层样式等专属配置原样保留）；
切换后立刻重渲染（不生效=恢复原文，按回来=重新渲染）；
面板状态行在不生效时显示 ⛔（否则会以为插件坏了）；
diagnose() 增加 cardOff{off,card}（可诊断，不做黑箱）；
没加载角色卡时明确提示「逐卡设置不可用」，不静默失败。

夹具 465 → 473：★★ off 只在 effectiveConfig 一个点翻、★ 按钮在、★ 动作处理在、
★ 只动 off 一个键、★ 切换后重渲染、★ 面板显示警告、★ diagnose 报 cardOff、★ 无卡时提示。

全量：compat-logic 658/0 · plot-pilot 67/67 · cine-dialogue 473/473 · ext-manage 49/49。
只改扩展 + 夹具 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）。
`;

fs.writeFileSync(process.env.TEMP + '/cd-msg-089.txt', MSG, 'utf8');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: R, encoding: 'utf8', ...opts });

run('git', ['add', '-A']);
console.log(run('git', ['commit', '-F', process.env.TEMP + '/cd-msg-089.txt']).trim().split('\n').slice(0, 2).join('\n'));

let pushed = false;
for (let i = 1; i <= 3 && !pushed; i++) {
    try { run('git', ['push']); pushed = true; console.log('push 成功'); }
    catch (e) { console.log('push 第 ' + i + ' 次失败，重试'); }
}
if (!pushed) { console.error('✗ push 失败'); process.exit(1); }

console.log(run('node', ['scripts/ext-install.mjs']).split('\n').filter((l) => l.includes('完成')).slice(0, 2).join('\n'));

// 已装目录核对
const path = await import('node:path');
const crypto = await import('node:crypto');
const EXT = 'extensions/cine-dialogue';
const DST = 'D:/AI/SillyTavern/Data/default-user/extensions/cine-dialogue';
const h = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
let bad = 0, n = 0;
for (const f of fs.readdirSync(EXT)) {
    const b = path.join(DST, f);
    if (!fs.existsSync(b) || h(path.join(EXT, f)) !== h(b)) bad++;
    n++;
}
console.log('  已装核对 ' + n + ' 个文件，不一致 ' + bad + '，版本 ' + JSON.parse(fs.readFileSync(path.join(DST, 'manifest.json'), 'utf8')).version);
console.log('  HEAD=' + run('git', ['rev-parse', '--short', 'HEAD']).trim());
