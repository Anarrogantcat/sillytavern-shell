// 提交 + 推送 + 部署 + 自检（0.8.10）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const R = 'D:/AI/DeepSeek Harness Workspace/sillytavern-shell';
process.chdir(R);
const run = (c, a, o = {}) => execFileSync(c, a, { cwd: R, encoding: 'utf8', ...o });

const MSG = `fix(cine-dialogue): 0.8.10 —— 空名字的行收起名字列（修「内容排版没对齐」）

现象（用户截图：海津岛那楼）：同一楼出现三种左边缘 ——
有名字的行（汐音/凪）正文从名字列之后开始；**空名字的行**（旁白、模型只写层名那类）
名字列空着、正文照样被推右一段；普通未标注段贴最左 ⇒ 第二类和第三类对不齐。

根因（实测，不是猜）：网格是 grid-template-columns: var(--cd-namew,96px) 1fr —— 固定名字列；
而 .cd-row{display:contents} 让名字格直接参与网格 ⇒ 名字为空也照样占 96px。
真机产物已验证：<span class="cd-who"></span> 空着也占位。

修法（两处标记 + 两条 CSS，选择器全是自有前缀）：
- rowHTML：名字为空时给名字格加 cd-noname（旁白恒定；普通行看 r.name 是否为空）
- CSS：.custom-cd-who.custom-cd-noname{display:none} +
       .custom-cd-who.custom-cd-noname + .custom-cd-body{grid-column:1 / -1}
  用相邻兄弟选择器 ⇒ 不必改 rowHTML 里正文那几行，风险最小
- 内置兜底 CSS 同步（否则取不到 style.css 时又会被推右）
- 顺带修正一处过时提示：layer-only 的 hover 原写「插件按旁白处理」，
  而 0.8.8 之后它是保留层名的 ⇒ 改成「插件不猜角色，就按写明的那个层渲染」

夹具 473 → 479：
- 两条旧断言（断言"空的 .cd-who"）按新标记更新，**意图「旁白不显示名字」不变**
- 新增：★★ 旁白与 layer-only 都带 cd-noname、★ 有名字的行不带、
  ★★ 不存在「空的 who 却没带 cd-noname」的行、★★ CSS 两条规则在、★ 兜底同步、
  ★ 选择器仍是自有前缀（先去注释再判 —— 注释里提到不算）

AGENTS.md v11：§1.6 第 2 条补「要全替换必须 split/join —— String.replace(字符串,…) 只替换第一处」
（同一会话里又栽一次：校验了命中 2 次却只改了一处，另一处漏网，靠夹具报红才发现）。

全量：compat-logic 658/0 · plot-pilot 67/67 · cine-dialogue 479/479 · ext-manage 49/49。
只改扩展 + 夹具 + 规则文件 → 不升套壳版本号、不打 tag、不发包（AGENTS 1.1）。
`;

fs.writeFileSync(process.env.TEMP + '/cd-msg-0810.txt', MSG, 'utf8');

run('git', ['add', '-A']);
console.log(run('git', ['commit', '-F', process.env.TEMP + '/cd-msg-0810.txt']).trim().split('\n').slice(0, 2).join('\n'));

let ok = false;
for (let i = 1; i <= 3 && !ok; i++) {
    try { run('git', ['push']); ok = true; console.log('push 成功'); }
    catch { console.log('push 第 ' + i + ' 次失败，重试'); }
}
if (!ok) { console.error('✗ push 失败'); process.exit(1); }

console.log(run('node', ['scripts/ext-install.mjs']).split('\n').filter((l) => l.includes('完成')).slice(0, 2).join('\n'));

const EXT = 'extensions/cine-dialogue';
const DST = 'D:/AI/SillyTavern/Data/default-user/extensions/cine-dialogue';
const h = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
let bad = 0; let n = 0;
for (const f of fs.readdirSync(EXT)) {
    const b = path.join(DST, f);
    if (!fs.existsSync(b) || h(path.join(EXT, f)) !== h(b)) bad++;
    n++;
}
console.log('  已装核对 ' + n + ' 文件，不一致 ' + bad + '，版本 ' + JSON.parse(fs.readFileSync(path.join(DST, 'manifest.json'), 'utf8')).version);
console.log('  HEAD=' + run('git', ['rev-parse', '--short', 'HEAD']).trim());
console.log('');
console.log(run('node', ['scripts/cine-dialogue-audit.mjs']).split('\n').slice(-4).join('\n'));
