// scripts/toolbox-test.mjs — 工具箱结构 + 接线静态校验（不启动 Electron）
// 防回归点：分组数量与名称、原有元素有没有被合并时弄丢、新入口（ST 扩展）在三层都接上了
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(repoRoot, 'shell.html'), 'utf8');
const js = fs.readFileSync(path.join(repoRoot, 'shell.js'), 'utf8');
const preload = fs.readFileSync(path.join(repoRoot, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(repoRoot, 'index.js'), 'utf8');

let pass = 0; const fails = [];
const ok = (n, c, extra) => { if (c) pass++; else fails.push(n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { actual: a, expected: b });

// 复刻 initToolboxGroups 的分组规则（按 .tool-sec 切段）
// 工具箱面板的结束位置用「下一个顶层面板」定位（mini-status 紧随 toolbox 之后），
// 不能拿某个控件（如 t-diag-res）当边界——分组顺序会变，写死会静默截断后半段
const bodyStart = html.indexOf('<div class="bench-body">');
const bodyEnd = html.indexOf('<div id="mini-status"');
ok('定位到工具箱面板正文', bodyStart > 0 && bodyEnd > bodyStart, { bodyStart, bodyEnd });
const bodyHtml = html.slice(bodyStart, bodyEnd);
const blocks = bodyHtml.split(/<div class="tool-sec">/).slice(1);
const groups = blocks.map((b) => ({
    name: b.slice(0, b.indexOf('</div>')).trim(),
    items: [...b.matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
}));

eq('工具箱分组数 = 8', groups.length, 8);
eq('分组名称', groups.map((g) => g.name), [
    '🗂 数据与导出', '🔎 检索与统计', '👁 角色卡与世界书', '🤖 模型与本地服务',
    '🧩 ST 扩展与插件', '🧪 兼容与检测', '💬 对话与界面', '🌐 网络与远程访问',
]);
ok('每组都有控件', groups.every((g) => g.items.length > 0), groups.map((g) => g.name + ':' + g.items.length));

const allIds = groups.flatMap((g) => g.items);
const dup = allIds.filter((id, i) => allIds.indexOf(id) !== i);
eq('没有重复 id', dup, []);
const must = ['t-backup-now', 't-backup-restore', 't-search-kw', 't-stats', 't-export-cards', 't-summarize', 't-export-html',
    't-portable', 't-card-list', 't-card-view', 't-worlds', 't-model-service', 't-env', 't-health', 't-ollama', 't-gpu',
    't-clash', 'llama-bin', 'llama-start', 'llama-stop', 't-rag', 't-draft', 't-chat', 't-immerse', 't-tunnel', 't-lan',
    't-lan-qr', 'zt-netid', 'zt-join', 'zt-leave', 't-mini', 't-diag-statusbar', 't-fix-statusbar', 't-render-statusbar',
    't-remember-statusbar', 't-ext-deploy', 't-ext-check', 't-ext-auto', 't-ext-res'];
const missing = must.filter((id) => !allIds.includes(id));
eq('原有/新增控件一个不少', missing, []);

// 三层接线
for (const [label, id, file] of [['shell.js 绑定部署按钮', 't-ext-deploy', js], ['shell.js 绑定检查按钮', 't-ext-check', js], ['shell.js 绑定自动开关', 't-ext-auto', js]]) {
    ok(label, file.includes("getElementById('" + id + "')"), id);
}
ok('shell.js 里没有残留旧分组名（📁 数据备份）', !js.includes('📁 数据备份'), '旧名还在');
ok('preload 暴露 extDeploy/extCheck/extAutoGet/extAutoSet', ['extDeploy', 'extCheck', 'extAutoGet', 'extAutoSet'].every((k) => preload.includes(k + ':')), 1);
ok('主进程注册四个 IPC', ['tools:extDeploy', 'tools:extCheck', 'tools:extAutoGet', 'tools:extAutoSet'].every((c) => main.includes("ipcMain.handle('" + c + "'")), 1);
ok('主进程有启动时在线检查', main.includes('checkExtensionUpdates()'), 1);
ok('shell.js 清理历史分组键', js.includes('toolboxFavoriteGroups') && js.includes('known.has(k)'), 1);

console.log('');
if (fails.length) { console.log('夹具结果：' + pass + ' 项通过，' + fails.length + ' 项失败'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('夹具结果：' + pass + '/' + pass + ' 全部通过');
