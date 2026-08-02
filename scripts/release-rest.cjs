// Create GitHub release via REST API + upload assets (curl-based, avoids gh graphql path)
const { execSync } = require('child_process');
const fs = require('fs');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Anarrogantcat', REPO = 'sillytavern-shell', TAG = 'v1.6.7';
const BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
const BODY = `## SillyTavern Desktop Shell v1.6.7

双版本安装包：完整版内置 SillyTavern（离线可用）；轻量版首次启动自动下载。

### 本次更新（重要修复）
- 修复 套壳更新「下载完不安装」：electron-updater 默认 logger 写 stdout，在管道已断的环境（GUI 启动器/重定向）会抛 EPIPE 导致主进程崩溃，下载完成后永远走不到安装步骤
  - stdout/stderr 增加 error 监听（EPIPE 不再导致崩溃）
  - autoUpdater 日志改接终端面板（[updater] 前缀），不再写 stdout
- 新增 更新链路测试脚本（本地更新服务器 + GitHub provider 全链路实测验证）

详见 CHANGELOG.md`;

function sh(cmd) { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
function esc(s) { return JSON.stringify(s); }

// 1. Create release
try {
    const payload = JSON.stringify({ tag_name: TAG, name: TAG, body: BODY });
    fs.writeFileSync('.gh-release.json', payload);
    const out = sh(`curl.exe -s -X POST -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" --data-binary @.gh-release.json ${BASE}/releases`);
    const rel = JSON.parse(out);
    console.log('release created:', rel.id, rel.html_url);
    fs.writeFileSync('.gh-release-id.txt', String(rel.id));
} catch (e) {
    const msg = e.stderr ? e.stderr.toString() : e.message;
    console.log('create failed:', msg.slice(0, 500));
    process.exit(1);
}

// 2. Upload assets
const assets = [
    'dist-electron-v3/SillyTavern-Setup-1.6.7.exe',
    'dist-electron-v3/SillyTavern-Setup-1.6.7.exe.blockmap',
    'dist-electron-v3/latest.yml',
    'dist-electron-v3-lite/SillyTavern-Lite-Setup-1.6.7.exe',
    'dist-electron-v3-lite/SillyTavern-Lite-Setup-1.6.7.exe.blockmap',
];
const relId = fs.readFileSync('.gh-release-id.txt', 'utf8').trim();
for (const a of assets) {
    const name = a.split('/').pop();
    const size = fs.statSync(a).size;
    console.log('uploading', name, `(${Math.round(size / 1048576 * 10) / 10} MB)...`);
    try {
        const out = sh(`curl.exe -s -X POST -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github+json" -H "Content-Type: application/octet-stream" --data-binary @${a} "https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${relId}/assets?name=${encodeURIComponent(name)}"`);
        const asset = JSON.parse(out);
        console.log('  uploaded:', asset.name, asset.state);
    } catch (e) {
        console.log('  FAIL:', (e.stderr ? e.stderr.toString() : e.message).slice(0, 300));
    }
}
fs.unlinkSync('.gh-release.json'); fs.unlinkSync('.gh-release-id.txt');
console.log('DONE');
