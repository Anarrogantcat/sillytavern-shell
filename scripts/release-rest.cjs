// Create GitHub release via REST API + upload assets (curl-based, avoids gh graphql path)
const { execSync } = require('child_process');
const fs = require('fs');

const TOKEN = process.env.GH_TOKEN;
const VERSION = process.argv[2] || '1.6.8';
const OWNER = 'Anarrogantcat', REPO = 'sillytavern-shell', TAG = `v${VERSION}`;
const BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
const BODY = `## SillyTavern Desktop Shell v${VERSION}

双版本安装包：完整版内置 SillyTavern（离线可用）；轻量版首次启动自动下载。

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
    // Some API calls create releases as draft — publish if so (draft releases are invisible to users/updaters)
    if (rel.draft === true) {
        fs.writeFileSync('.gh-publish.json', '{"draft": false}');
        const pub = sh(`curl.exe -s -X PATCH -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" --data-binary @.gh-publish.json ${BASE}/releases/${rel.id}`);
        fs.unlinkSync('.gh-publish.json');
        const pr = JSON.parse(pub);
        console.log('release was draft → published:', pr.draft === false ? 'OK' : 'FAILED');
    }
} catch (e) {
    const msg = e.stderr ? e.stderr.toString() : e.message;
    console.log('create failed:', msg.slice(0, 500));
    process.exit(1);
}

// 2. Upload assets
const assets = [
    `dist-electron-v3/SillyTavern-Setup-${VERSION}.exe`,
    `dist-electron-v3/SillyTavern-Setup-${VERSION}.exe.blockmap`,
    'dist-electron-v3/latest.yml',
    `dist-electron-v3-lite/SillyTavern-Lite-Setup-${VERSION}.exe`,
    `dist-electron-v3-lite/SillyTavern-Lite-Setup-${VERSION}.exe.blockmap`,
    'dist-electron-v3-lite/lite.yml',
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
