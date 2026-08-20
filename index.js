import { app, BrowserWindow, ipcMain, session, Tray, Menu, nativeImage, dialog, shell, Notification, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, exec, execSync } from 'node:child_process';
import https from 'node:https';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { registerAppTools } from './lib/tools-app.js';
import { registerDataTools, detectModel as dataDetectModel, chatOnce as dataChatOnce } from './lib/tools-data.js';
import { registerEnvTools } from './lib/tools-env.js';
import { registerChatTools } from './lib/tools-chat.js';
import { registerTunnelTools } from './lib/tools-tunnel.js';
import { registerZtTools } from './lib/tools-zt.js';

// ── Stream safety ──────────────────────────────────────────────────
// electron-updater's default logger writes to console (stdout). When the
// app is launched with a closed/broken stdout pipe (GUI launchers, redirects),
// that write throws EPIPE and — without a handler — becomes an Uncaught
// Exception that kills the app before update-downloaded can install.
// Swallow stream errors so a dead pipe can never crash the main process.
for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', () => { /* EPIPE etc. — never crash the app */ });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const TERMINAL_RING_SIZE = 5000;

// ── Settings ─────────────────────────────────────────────────────────
function loadSettings() {
    try { return fs.existsSync(SETTINGS_PATH) ? JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) : {}; }
    catch (_) { return {}; }
}
function saveSettings(obj) {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(obj, null, 2));
}

// ── CLI ──────────────────────────────────────────────────────────────
const cliArguments = yargs(hideBin(process.argv))
    .option('width', { type: 'number', default: 1280 })
    .option('height', { type: 'number', default: 800 })
    .option('server-path', { type: 'string' })
    .parseSync();

const settings = loadSettings();
// Default closeBehavior to 'ask' — first close always asks (only when never set)
if (settings.closeBehavior === undefined) {
    settings.closeBehavior = 'ask';
    saveSettings(settings);
}
// ST lives as SIBLING of the shell install dir — shell upgrade/uninstall never touches it
const defaultST = app.isPackaged
    ? path.join(path.dirname(process.resourcesPath), '..', 'SillyTavern')
    : path.resolve(__dirname, '..', 'SillyTavern');
if (!settings.serverPath) { settings.serverPath = defaultST; saveSettings(settings); }
else if (/[\\/]resources[\\/]sillytavern$/i.test(settings.serverPath)) {
    // Old layout (ST inside shell resources) — migrate to sibling dir
    settings.serverPath = path.join(path.dirname(settings.serverPath), '..', '..', 'SillyTavern');
    saveSettings(settings);
}
const sillyTavernRoot = cliArguments.serverPath || settings.serverPath || defaultST;
// ── P0 安全：禁止递归删除危险路径（盘符根/系统根/用户主目录/套壳自身/项目根/数据目录）──
// 双向检查：目标在受保护目录内，或受保护目录在目标内（后者会随 rm -rf 一起被删）。
function isUnsafeRmPath(p) {
    try {
        const r = path.resolve(String(p || ''));
        if (/^[A-Za-z]:[\\/]?$/.test(r) || r === '/' || r === '\\') return true; // 盘符根/系统根
        const guard = [app.getPath('home'), app.getPath('documents'), app.getPath('downloads'), dataRoot];
        if (app.isPackaged) guard.push(path.dirname(process.execPath)); else guard.push(path.resolve(__dirname));
        for (const g of guard) {
            if (r === g || r.startsWith(g + path.sep) || g.startsWith(r + path.sep)) return true;
        }
        return false;
    } catch (_) { return true; }
}
function assertSafeRmPath(p) {
    if (isUnsafeRmPath(p)) throw new Error(`拒绝删除危险路径: ${p}`);
}
// User data lives OUTSIDE resources — upgrade/reinstall never touches it
const dataRoot = settings.dataRoot || (app.isPackaged
    ? path.join(path.dirname(process.resourcesPath), '..', 'Data')
    : path.join(path.resolve(__dirname, '../..'), 'Data'));

// 修复旧版本已保存的危险 serverPath（例如 D:\）：能用安全路径时自动纠偏，不能则下面的拦截会退出
if (settings.serverPath && isUnsafeRmPath(settings.serverPath)) {
    settings.serverPath = sillyTavernRoot;
    saveSettings(settings);
}

// CLI --server-path 与已保存的 serverPath 都必须通过同一安全校验（setup/迁移可能 rm 该目录）
if (isUnsafeRmPath(sillyTavernRoot)) {
    console.error(`[sillytavern-shell] 拒绝使用危险服务器路径: ${sillyTavernRoot}`);
    app.exit(1);
}

// ── Git safe.directory ────────────────────────────────────────────
// After a Windows reinstall (new user SID) git refuses to touch repos owned
// by the old account ("dubious ownership"), which breaks ST update (git pull)
// and the integrity check (git ls-files). Add the ST root as safe once, at
// startup, so both features keep working across reinstall/relocation.
// B12 启动加速：safe.directory 检查异步化（execSync 会阻塞启动，改用 exec 后台执行）
// 覆盖范围：ST 本体 + 用户扩展目录（Data/default-user/extensions/*）
// ——重装系统后旧账号创建的 git 仓库报 dubious ownership → ST 插件/扩展更新 500
(function ensureGitSafeDir() {
    try {
        const cwd = sillyTavernRoot;
        if (!fs.existsSync(path.join(cwd, '.git'))) return; // not a git repo — nothing to do
        exec('git config --global --get-all safe.directory', { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }, (err, stdout) => {
            try {
                const existing = new Set(String(stdout || '').split('\n').map(s => s.trim()).filter(Boolean));
                const targets = [cwd];
                // 用户扩展目录（ST 1.18 装在 Data 下，插件更新走 git pull）
                try {
                    const extRoot = path.join(dataRoot, 'default-user', 'extensions');
                    if (fs.existsSync(extRoot)) {
                        for (const f of fs.readdirSync(extRoot)) {
                            const p = path.join(extRoot, f);
                            if (fs.existsSync(path.join(p, '.git'))) targets.push(p);
                        }
                    }
                } catch (_) { /* non-fatal */ }
                for (const t of targets) {
                    if (!existing.has(t)) {
                        exec(`git config --global --add safe.directory "${t}"`, { stdio: 'ignore', windowsHide: true }, () => {
                            terminalWrite(`[git] added safe.directory ${t}\n`);
                        });
                    }
                }
            } catch (_) { /* non-fatal */ }
        });
    } catch (_) { /* non-fatal */ }
})();

// ── 对话 Token 自动统计（只读监听聊天文件，生成完成通知）─────────
// 只读 ST 数据（settings.json / 聊天记录），零写入本体，不依赖 ST 内部 API。
// 自动监听当前角色卡的聊天文件：消息生成完成（写盘）→ 统计 Token；
// 10 分钟窗口分组为"一次对话"；统计结果供工具箱聊天统计使用。
const BENCH_SESSION_WINDOW_MS = 10 * 60 * 1000;
const BENCH_MAX_SESSIONS = 3;
// Tools 工具箱实例（setupIPC 时赋值，托盘/监听回调共用）
let toolsApp = null;
let toolsData = null;
let lastNotifyTs = 0;
const benchState = {
    activeCharacter: null,
    model: null,
    sessions: [],        // [{total, reply, lastTs}] 已结束的对话
    current: null,       // 进行中的对话 {total, reply, lastTs}
    benchTimer: null,    // 10s 轮询扫描定时器
    mtimes: {},          // 聊天文件 mtime 缓存（性能优化）
    fileBytes: new Map(),
    tokenQueue: Promise.resolve(),
};
function benchGetSettings() {
    try { return JSON.parse(fs.readFileSync(path.join(dataRoot, 'default-user', 'settings.json'), 'utf8')); }
    catch (_) { return {}; }
}
function benchDetectModel() {
    const s = benchGetSettings();
    const oai = s.oai_settings || {};
    const src = oai.chat_completion_source || 'custom';
    const map = {
        custom: ['custom_url', 'custom_model'], openai: ['openai_url', 'openai_model'],
        ollama: ['ollama_url', 'ollama_model'], openrouter: ['openrouter_url', 'openrouter_model'],
        claude: ['claude_url', 'claude_model'], gemini: ['google_url', 'google_model'],
    };
    let url = '', model = '';
    const keys = map[src];
    if (keys) { url = oai[keys[0]] || ''; model = oai[keys[1]] || ''; }
    if (!url && oai.custom_url) { url = oai.custom_url; if (!model) model = oai.custom_model; }
    return { source: src, url, model };
}
function benchOllamaBase(url) { return String(url || '').replace(/\/v1\/?$/, '').replace(/\/+$/, ''); }
function benchIsOllama(url) { return /(localhost|127\.0\.0\.1):11434/i.test(String(url || '')); }
async function benchTokenize(text) {
    const { url, model } = benchState.model || {};
    if (url && model && benchIsOllama(url)) {
        try {
            const r = await fetch(benchOllamaBase(url) + '/api/tokenize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt: String(text || '') }), signal: AbortSignal.timeout(3000) });
            if (r.ok) { const j = await r.json(); return j.count || 0; }
        } catch (_) {}
    }
    const t = String(text || '');
    let cjk = 0, other = 0;
    for (const ch of t) { if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) cjk++; else other++; }
    return Math.max(1, Math.round(cjk / 1.5 + other / 4));
}
function benchActiveCharDir() {
    const s = benchGetSettings();
    const char = s.active_character || '';
    const dirName = String(char).replace(/\.[^.]+$/, '');
    return { char, dir: dirName ? path.join(dataRoot, 'default-user', 'chats', dirName) : null };
}
function benchLatestChatFile(dir) {
    if (!dir || !fs.existsSync(dir)) return null;
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch (_) { return null; }
    if (!files.length) return null;
    // 性能优化：mtime 缓存（benchState.mtimes），每轮只 stat 新文件名；已见过的文件用缓存
    const now = Date.now();
    let best = null, bestM = -1;
    const mtimes = benchState.mtimes || (benchState.mtimes = {});
    for (const f of files) {
        let m = mtimes[f];
        if (m === undefined) {
            try { m = fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) { continue; }
            mtimes[f] = m;
            if (Object.keys(mtimes).length > 200) for (const k of Object.keys(mtimes)) { if (!files.includes(k)) delete mtimes[k]; } // 清理已删除文件
        }
        if (m > bestM) { bestM = m; best = f; }
    }
    return best ? path.join(dir, best) : null;
}
function benchScanOnce() {
    // Poll-based watcher: resilient to fs.watch quirks (non-recursive dirs, missed events,
    // rename storms) and automatically follows active-character / new-chat changes.
    const { char, dir } = benchActiveCharDir();
    if (char !== benchState.activeCharacter) {
        benchState.activeCharacter = char || null;
        benchState.fileBytes.clear();
        benchState.sessions = [];
        benchState.current = null;
    }
    if (!dir) return;
    const f = benchLatestChatFile(dir);
    if (!f) return;
    // 增量读取：open→read→close（不驻留句柄！Windows 上驻留句柄会阻止 ST 保存聊天
    // 的临时文件重命名操作 → 聊天无法保存；v1.8.12 曾因此引入严重 bug）
    try {
        const st = fs.statSync(f);
        const prev = benchState.fileBytes.get(f);
        if (prev === undefined || st.size <= prev) {
            benchState.fileBytes.set(f, st.size);
            return;
        }
        benchState.fileBytes.set(f, st.size);
        const len = st.size - prev;
        if (len <= 0 || len > 5 * 1024 * 1024) return; // 异常增量防护
        const fd = fs.openSync(f, 'r');
        let buf;
        try {
            buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, prev);
        } finally {
            fs.closeSync(fd); // 立即关闭，绝不驻留
        }
        for (const line of buf.toString('utf8').split('\n')) {
            if (!line.trim()) continue;
            let msg = null;
            try { msg = JSON.parse(line); } catch (_) { continue; }
            if (!msg || msg.chat_metadata || !msg.mes) continue;
            benchQueueTokenize(msg);
        }
    } catch (_) { /* 文件被占用/轮换，下轮重试 */ }
}
function benchStartWatcher() {
    benchStopWatcher();
    if (!benchState.model) benchState.model = benchDetectModel(); // tokenize 需要模型配置
    benchScanOnce();
    benchState.benchTimer = setInterval(benchScanOnce, 10000);
}
function benchStopWatcher() {
    if (benchState.benchTimer) { clearInterval(benchState.benchTimer); benchState.benchTimer = null; }
}
function benchQueueTokenize(msg) {
    benchState.tokenQueue = benchState.tokenQueue.then(async () => {
        const count = await benchTokenize(msg.mes);
        let sendTs = Date.now();
        try { sendTs = new Date(msg.send_date).getTime(); } catch (_) {}
        if (isNaN(sendTs)) sendTs = Date.now();
        if (!benchState.current || sendTs - benchState.current.lastTs > BENCH_SESSION_WINDOW_MS) {
            if (benchState.current && benchState.current.total > 0) {
                benchState.sessions.push(benchState.current);
                if (benchState.sessions.length > BENCH_MAX_SESSIONS) benchState.sessions.shift();
            }
            benchState.current = { total: 0, reply: 0, lastTs: sendTs };
        }
        benchState.current.total += count;
        if (!msg.is_user) {
            benchState.current.reply += count;
            // A2: 迷你状态窗——生成完成事件（耗时 = 本次回复与上一条消息写入时间差）
            const genMs = benchState.current.lastTs ? sendTs - benchState.current.lastTs : 0;
            mainWindow?.webContents.send('mini:state', { state: 'done', char: benchState.activeCharacter || '角色', ms: genMs > 0 ? genMs : null, toks: count });
            // B9: 生成完成通知（10s 节流）
            const now = Date.now();
            if (now - lastNotifyTs > 10000) {
                lastNotifyTs = now;
                try { toolsData?.notifyGenerated(benchState.activeCharacter || '角色', count); } catch (_) {}
            }
        } else {
            // 用户消息写入 → 生成中（等回复）
            mainWindow?.webContents.send('mini:state', { state: 'gen', char: benchState.activeCharacter || '角色' });
        }
        benchState.current.lastTs = Math.max(benchState.current.lastTs, sendTs);
    }).catch(() => {});
}

// ── SillyTavern Setup (first launch) ─────────────────────────────────
function isSillyTavernInstalled() {
    return fs.existsSync(path.join(sillyTavernRoot, 'server.js')) && fs.existsSync(path.join(sillyTavernRoot, 'node_modules'));
}

async function checkDependencies() {
    const results = [], isWin = process.platform === 'win32';
    const checks = [
        { tool: 'git', args: ['--version'], help: 'https://git-scm.com/download/win' },
        { tool: 'node', args: ['--version'], help: 'https://nodejs.org/' },
        { tool: isWin ? 'npm.cmd' : 'npm', args: ['--version'], help: 'https://nodejs.org/' },
    ];
    for (const { tool, args, help } of checks) {
        const ok = await new Promise(resolve => {
            const p = spawn(tool, args, { stdio: 'pipe', shell: isWin });
            p.stdout?.on('data', () => {});
            p.stderr?.on('data', () => {});
            p.on('error', () => resolve(false));
            p.on('exit', code => resolve(code === 0));
            setTimeout(() => { try { p.kill(); } catch(_){} resolve(false); }, 3000);
        });
        if (!ok) results.push(`${tool} 未安装 (${help})`);
    }
    return results;
}

async function setupSillyTavern() {
    const isWin = process.platform === 'win32', npmCmd = isWin ? 'npm.cmd' : 'npm', shell = isWin;
    terminalWrite('\x1b[36m> 🔍 Checking dependencies...\x1b[0m');
    const missing = await checkDependencies();
    if (missing.length > 0) throw new Error('缺少必要工具：\n' + missing.join('\n'));
    terminalWrite('\x1b[32mAll dependencies OK\x1b[0m');

    // Clean up non-empty directory before git clone (git requires empty dir)
    if (fs.existsSync(sillyTavernRoot)) {
        // P0 安全：拒绝删除盘符根/主目录/套壳自身等危险路径
        assertSafeRmPath(sillyTavernRoot);
        // Safety: never delete user data if dataRoot is inside the ST dir
        const dataInside = dataRoot.startsWith(sillyTavernRoot + path.sep);
        terminalWrite('\x1b[36m> Cleaning up old files...\x1b[0m');
        if (dataInside) {
            const tmp = path.join(path.dirname(sillyTavernRoot), '.data-tmp');
            fs.rmSync(tmp, { recursive: true, force: true });
            fs.cpSync(dataRoot, tmp, { recursive: true, force: true });
        }
        fs.rmSync(sillyTavernRoot, { recursive: true, force: true });
        if (dataInside) { fs.cpSync(path.join(path.dirname(sillyTavernRoot), '.data-tmp'), dataRoot, { recursive: true, force: true }); fs.rmSync(path.join(path.dirname(sillyTavernRoot), '.data-tmp'), { recursive: true, force: true }); }
    }
    fs.mkdirSync(sillyTavernRoot, { recursive: true });

    terminalWrite('\x1b[36m> git clone https://github.com/SillyTavern/SillyTavern -b release ...\x1b[0m');
    await new Promise((resolve, reject) => {
        const git = spawn('git', ['clone', 'https://github.com/SillyTavern/SillyTavern', '-b', 'release', sillyTavernRoot], { stdio: ['ignore', 'pipe', 'pipe'], shell });
        git.stdout.on('data', d => terminalWrite(d));
        git.stderr.on('data', d => terminalWrite(d));
        git.on('error', reject);
        git.on('exit', code => code === 0 ? resolve() : reject(new Error(`git clone exited with code ${code}`)));
    });

    terminalWrite('\x1b[36m> npm install --omit=dev ...\x1b[0m');
    await new Promise((resolve, reject) => {
        const npm = spawn(npmCmd, ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: sillyTavernRoot, stdio: ['ignore', 'pipe', 'pipe'], shell });
        npm.stdout.on('data', d => terminalWrite(d));
        npm.stderr.on('data', d => terminalWrite(d));
        npm.on('error', reject);
        npm.on('exit', code => code === 0 ? resolve() : reject(new Error(`npm install exited with code ${code}`)));
    });

    terminalWrite('\x1b[32mSillyTavern installed successfully!\x1b[0m');
}

// ── Terminal buffer ──────────────────────────────────
let terminalLines = [], termSendBuf = '', termSendTimer = null;
function terminalWrite(text) {
    const lines = text.toString().split('\n');
    for (const line of lines) { terminalLines.push(line); } // 保留空行，历史显示更接近真实终端
    while (terminalLines.length > TERMINAL_RING_SIZE) terminalLines.shift();
    // Coalesce high-frequency log floods into one IPC message per 80ms window
    termSendBuf += text.toString();
    if (termSendTimer) return;
    termSendTimer = setTimeout(() => {
        termSendTimer = null;
        const payload = termSendBuf; termSendBuf = '';
        mainWindow?.webContents.send('terminal:output', payload);
    }, 80);
}

// ── Window State ─────────────────────────────────────────────────────
const STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
    try { if (fs.existsSync(STATE_PATH)) { const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); if (d && typeof d.width === 'number') {
        // 审计：显示器边界校验（防止窗口恢复到屏幕外）
        const sw = screen?.getPrimaryDisplay?.()?.workAreaSize?.width || 9999;
        const sh = screen?.getPrimaryDisplay?.()?.workAreaSize?.height || 9999;
        if (typeof d.x === 'number' && (d.x < -d.width + 80 || d.x > sw - 80)) delete d.x;
        if (typeof d.y === 'number' && (d.y < -20 || d.y > sh - 80)) delete d.y;
        return d;
    } } } catch (_) {}
    return null;
}
function saveWindowState(win) {
    if (!win || win.isDestroyed()) return;
    const m = win.isMaximized(); const b = m ? win._lastNormalBounds : win.getBounds();
    if (!b) return;
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: m }, null, 2)); } catch (_) {}
}

// ── Tray ─────────────────────────────────────────────────────────────
function createTrayIconRaw() {
    const s = 16, buf = Buffer.alloc(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const d = Math.abs(x - 7.5) + Math.abs(y - 7.5), i = (y * s + x) * 4;
        if (d <= 6) { buf[i] = 124; buf[i + 1] = 92; buf[i + 2] = 191; buf[i + 3] = Math.min(255, Math.round((1 - d / 7) * 255)); }
    }
    return nativeImage.createFromBuffer(buf, { width: s, height: s, scaleFactor: 1 });
}
let tray = null, isQuitting = false;
function createTray() {
    const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, 'assets/icon.png');
    let icon;
    try { icon = nativeImage.createFromPath(iconPath); if (icon.isEmpty()) throw new Error(); } catch (_) { icon = createTrayIconRaw(); }
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('SillyTavern');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示窗口', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
        { type: 'separator' },
        { label: '立即备份数据', click: async () => { try { const d = await toolsApp?.doBackup(); terminalWrite(`[tray] ${d}\n`); } catch (e) { terminalWrite(`[tray] 备份失败: ${e.message}\n`); } } },
        { type: 'separator' },
        { label: '打开数据目录', click: () => shell.openPath(dataRoot) },
        { label: '打开角色卡目录', click: () => shell.openPath(path.join(dataRoot, 'default-user', 'characters')) },
        { label: '打开 ST 目录', click: () => shell.openPath(sillyTavernRoot) },
        { label: '打开 Ollama 目录', click: () => shell.openPath(process.env.OLLAMA_MODELS ? path.dirname(process.env.OLLAMA_MODELS) : 'D:\\AI\\ollama-models') },
        { type: 'separator' },
        { label: '退出', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── Window ───────────────────────────────────────────────────────────
let mainWindow = null, serverProcess = null, serverUrl = null;

// ── basicAuth 登录弹窗状态（只保存在套壳 settings，不写 ST 本体）──
let pendingAuth = null;      // { callback, host }
let pendingAuthTimer = null;
let authAutoTriedAt = 0;     // 自动登录节流，避免错误凭据导致无限 401 循环
let authOneShot = null;     // Unauthorized 页面触发的重试凭据（一次性，来自 shell:auth-retry）
function createWindow() {
    const saved = loadWindowState();
    const opts = {
        width: saved?.width || settings.windowWidth || cliArguments.width,
        height: saved?.height || settings.windowHeight || cliArguments.height,
        minWidth: 640, minHeight: 480, frame: false, backgroundColor: '#0f0f1a', show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true },
    };
    if (saved && !saved.maximized) { opts.x = saved.x; opts.y = saved.y; }
    mainWindow = new BrowserWindow(opts);
    if (saved?.maximized) mainWindow.maximize();
    // B2 窗口置顶：启动时应用设置
    try { if (settings.alwaysOnTop) mainWindow.setAlwaysOnTop(true); } catch (_) {}
    // P1 安全：禁止任何 window.open 子窗口（远程页面可能继承 preload → RCE 面）
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.loadFile(path.join(__dirname, 'shell.html'));
    mainWindow.once('ready-to-show', () => mainWindow.show());
    const track = () => { if (!mainWindow?.isMaximized()) mainWindow._lastNormalBounds = mainWindow.getBounds(); };
    mainWindow.on('resize', track); mainWindow.on('move', track);
    const save = debounce(() => saveWindowState(mainWindow), 300);
    ['resize', 'move', 'maximize', 'unmaximize'].forEach(e => mainWindow.on(e, save));
    mainWindow.on('close', (e) => {
        if (isQuitting) return;
        e.preventDefault();
        const behavior = settings.closeBehavior || 'ask';
        if (behavior === 'tray') {
            mainWindow.hide();
            try { new Notification({ title: 'SillyTavern 仍在后台运行', body: '已最小化到系统托盘。点击托盘图标可恢复窗口,右键托盘图标选择"退出"可完全关闭。' }).show(); } catch (_) {}
        }
        else if (behavior === 'quit') { isQuitting = true; app.quit(); }
        else {
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'question', title: '关闭 SillyTavern',
                message: '关闭窗口时如何处理？',
                detail: '你可以随时在设置中更改此选项。',
                buttons: ['最小化到托盘', '直接退出', '取消'],
                defaultId: 0, cancelId: 2,
            });
            if (choice === 0) { settings.closeBehavior = 'tray'; saveSettings(settings); mainWindow.hide(); try { new Notification({ title: 'SillyTavern 仍在后台运行', body: '已最小化到系统托盘。点击托盘图标可恢复窗口,右键托盘图标选择"退出"可完全关闭。' }).show(); } catch (_) {} }
            else if (choice === 1) { settings.closeBehavior = 'quit'; saveSettings(settings); isQuitting = true; app.quit(); }
        }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC ──────────────────────────────────────────────────────────────
let ipcRegistered = false;
function setupIPC() {
    if (ipcRegistered) return;
    ipcRegistered = true;
    const w = () => mainWindow;
    ipcMain.handle('window:minimize', () => w()?.minimize());
    ipcMain.handle('window:maximize', () => { if (w()?.isMaximizable()) w().isMaximized() ? w().unmaximize() : w().maximize(); });
    ipcMain.handle('window:close', () => w()?.close());
    ipcMain.handle('window:isMaximized', () => w()?.isMaximized() ?? false);
    ipcMain.handle('shell:openExternal', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); });
    w()?.on('maximize', () => w()?.webContents.send('window:maximizeChange', true));
    w()?.on('unmaximize', () => w()?.webContents.send('window:maximizeChange', false));

    // basicAuth 登录弹窗：渲染进程回传凭据/取消
    ipcMain.handle('shell:auth-respond', (_e, payload) => {
        const auth = pendingAuth;
        pendingAuth = null;
        if (pendingAuthTimer) { clearTimeout(pendingAuthTimer); pendingAuthTimer = null; }
        if (!auth) return { ok: false, error: 'no pending auth' };
        if (!payload || payload.cancel) { auth.callback(); return { ok: true, canceled: true }; }
        const user = String(payload.user || '');
        const pass = String(payload.pass || '');
        auth.callback(user, pass);
        return { ok: true };
    });
    // Unauthorized 页面已显示（没有 pendingAuth）时，渲染进程存一次性凭据并重载 webview
    ipcMain.handle('shell:auth-retry', (_e, payload) => {
        const user = String(payload?.user || '');
        const pass = String(payload?.pass || '');
        if (user) authOneShot = { user, pass };
        return { ok: true };
    });

    // ST 完整性检测：改用主进程直接执行，避免 node -e 字符串拼接受特殊字符影响
    ipcMain.handle('tools:integrityCheck', async () => {
        try {
            let git = false;
            try { git = execSync('git rev-parse --is-inside-work-tree', { cwd: sillyTavernRoot, stdio: 'pipe' }).toString().trim() === 'true'; } catch (_) { git = false; }
            const out = [];
            const coreFiles = ['server.js', 'package.json', 'public/index.html'];
            if (git) {
                try {
                    const del = execSync('git ls-files --deleted', { cwd: sillyTavernRoot, stdio: 'pipe' }).toString().trim().split(/\r?\n/).filter(l => l && !l.startsWith('data/'));
                    del.forEach(l => out.push('MISSING ' + l));
                } catch (_) {
                    out.push('git 检查失败（目录可能未信任，正在使用文件检查）');
                    for (const f of coreFiles) if (!fs.existsSync(path.join(sillyTavernRoot, f))) out.push('MISSING ' + f);
                }
            } else {
                for (const f of coreFiles) if (!fs.existsSync(path.join(sillyTavernRoot, f))) out.push('MISSING ' + f);
            }
            if (!fs.existsSync(path.join(sillyTavernRoot, 'node_modules'))) out.push('MISSING node_modules');
            return { git, out };
        } catch (e) { return { error: e.message }; }
    });

    ipcMain.handle('settings:get', () => { const copy = { ...settings }; delete copy.pin; copy.hasPin = !!settings.pin; return copy; });
    ipcMain.handle('settings:save', (_e, s) => {
        if (s && typeof s === 'object') {
            // 设置面板保存走这里，必须与 settings:setServerPath 同一安全校验，
            // 否则用户可绕过危险路径拦截，重启后 setup 可能 rm 掉安装目录/数据目录。
            if (typeof s.serverPath === 'string') {
                const p = s.serverPath.trim();
                if (!p || isUnsafeRmPath(p)) return { error: '拒绝保存危险路径（盘符根/系统根/主目录/套壳自身/数据目录或其父目录）' };
                s = { ...s, serverPath: p };
            }
            Object.assign(settings, s);
            saveSettings(settings);
        }
        return { ok: true };
    });
    ipcMain.handle('settings:getServerPath', () => sillyTavernRoot);
    ipcMain.handle('settings:setServerPath', (_e, p) => { if (typeof p !== 'string') return { error: 'invalid path' }; const clean = p.trim(); if (!clean || isUnsafeRmPath(clean)) return { error: '拒绝设置危险路径（盘符根/系统根/主目录/套壳自身/数据目录或其父目录）' }; settings.serverPath = clean; saveSettings(settings); return { ok: true }; });
    ipcMain.handle('settings:getDataRoot', () => dataRoot);
    ipcMain.handle('shell:openPath', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.openPath(p); });

    ipcMain.handle('server:restart', async () => {
        stopServer();
        try { await startServer(); return { success: true }; }
        catch (e) { return { success: false, error: e.message }; }
    });
    ipcMain.handle('server:getUrl', () => serverUrl);

    ipcMain.handle('terminal:getHistory', () => terminalLines.join('\n'));
    ipcMain.handle('terminal:exec', (_e, cmd) => new Promise(resolve => {
        exec(cmd, { cwd: sillyTavernRoot, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ stdout: stdout || '', stderr: stderr || '', error: err?.message || null });
        });
    }));

    ipcMain.handle('app:getShellVersion', () => {
        try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version || '1.0.0'; }
        catch (_) { return '1.0.0'; }
    });
    ipcMain.handle('app:getVersion', () => {
        try { return JSON.parse(fs.readFileSync(path.join(sillyTavernRoot, 'package.json'), 'utf-8')).version || 'unknown'; }
        catch (_) { return 'unknown'; }
    });
    ipcMain.handle('app:getChangelog', () => {
        const p = app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'CHANGELOG.md') : path.join(__dirname, 'CHANGELOG.md');
        try { return fs.readFileSync(p, 'utf-8'); } catch (_) { return '# 暂无更新日志'; }
    });

    ipcMain.handle('update:check', () => new Promise(resolve => {
        const req = https.get({ hostname: 'api.github.com', path: '/repos/SillyTavern/SillyTavern/releases/latest', headers: { 'User-Agent': 'SillyTavern-Electron', Accept: 'application/vnd.github+json' } }, res => {
            let body = ''; res.on('data', d => body += d); res.on('end', () => {
                try {
                    const r = JSON.parse(body);
                    const cur = JSON.parse(fs.readFileSync(path.join(sillyTavernRoot, 'package.json'), 'utf-8')).version;
                    const latest = r.tag_name?.replace(/^v/, '') || '';
                    const v2n = s => String(s).split('.').reduce((a, n) => a * 100 + (parseInt(n, 10) || 0), 0);
                    resolve({ latest, current: cur, hasUpdate: latest && v2n(latest) > v2n(cur), url: r.html_url });
                } catch (_) { resolve({ error: 'Failed to parse release info' }); }
            });
        });
        req.on('error', e => resolve({ error: e.message }));
        req.setTimeout(10000, () => { req.destroy(); resolve({ error: '连接 GitHub 超时 (10s)' }); });
    }));

    ipcMain.handle('update:sillytavern', async () => {
        // 完整版内置 ST 不打包 .git（prebuild SKIP_DIRS），git pull 必然失败——给出明确指引
        if (!fs.existsSync(path.join(sillyTavernRoot, '.git'))) {
            return { error: '当前为完整版内置 ST（无 git 仓库）。请通过「检查套壳更新」升级整个应用，内置 ST 会随套壳版本更新。' };
        }
        stopServer();
        const isWin = process.platform === 'win32', npmCmd = isWin ? 'npm.cmd' : 'npm', shell = isWin;
        try {
            await new Promise((resolve, reject) => {
                terminalWrite('\x1b[36m> git pull --rebase --autostash ...\x1b[0m');
                const git = spawn('git', ['pull', '--rebase', '--autostash'], { cwd: sillyTavernRoot, stdio: ['ignore', 'pipe', 'pipe'], shell });
                git.stdout.on('data', d => terminalWrite(d));
                git.stderr.on('data', d => terminalWrite(d));
                git.on('error', reject);
                git.on('exit', code => code === 0 ? resolve() : reject(new Error(`git pull exited with code ${code} — 如遇冲突请备份后执行: git reset --hard && git pull`)));
            });
            await new Promise((resolve, reject) => {
                terminalWrite('\x1b[36m> npm install --omit=dev ...\x1b[0m');
                const npm = spawn(npmCmd, ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: sillyTavernRoot, stdio: ['ignore', 'pipe', 'pipe'], shell });
                npm.stdout.on('data', d => terminalWrite(d));
                npm.stderr.on('data', d => terminalWrite(d));
                npm.on('error', reject);
                npm.on('exit', code => code === 0 ? resolve() : reject(new Error(`npm install exited with code ${code}`)));
            });
        } catch (e) {
            // Never leave the server down after a failed update — try to bring it back
            try { await startServer(); } catch (se) { terminalWrite('\x1b[31mFailed to restart server: ' + se.message + '\x1b[0m'); }
            throw e;
        }
        try { await startServer(); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
    });

    // Shell auto-update
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // electron-updater does NOT set installDirectory by default → the NSIS
    // installer would fall back to its default path (%LOCALAPPDATA%\Programs\...)
    // instead of the CURRENT install dir. Pin it so updates install back in place.
    try { autoUpdater.installDirectory = path.dirname(app.getPath('exe')); } catch (_) {}
    // Route updater logs to the terminal panel instead of stdout —
    // console/stdout writes can throw EPIPE on broken pipes and crash the app.
    autoUpdater.logger = {
        info: m => terminalWrite(`[updater] ${m}\n`),
        warn: m => terminalWrite(`[updater] ${m}\n`),
        error: m => terminalWrite(`[updater] ${m}\n`),
        debug: m => terminalWrite(`[updater] ${m}\n`),
    };
    let shellUpdateVersion = null;
    // ── Context menu (webview has no default one) ─────────────────────
    ipcMain.on('app:contextMenu', (e, opts = {}) => {
        const w = mainWindow;
        if (!w) return;
        const toShell = cmd => w.webContents.send('ctx:cmd', cmd);
        const menu = opts.kind === 'webview'
            ? Menu.buildFromTemplate([
                { label: '复制', role: 'copy', enabled: !!opts.hasSelection },
                { label: '粘贴', role: 'paste' },
                { label: '全选', role: 'selectAll' },
                { type: 'separator' },
                { label: '刷新', click: () => toShell('reload') },
                { label: '返回', click: () => toShell('goBack') },
                { label: '前进', click: () => toShell('goForward') },
                { type: 'separator' },
                { label: '放大', click: () => toShell('zoomIn') },
                { label: '缩小', click: () => toShell('zoomOut') },
                { label: '重置缩放', click: () => toShell('zoomReset') },
                { type: 'separator' },
                { label: '检查元素', click: () => toShell('inspect') },
            ])
            : Menu.buildFromTemplate([
                { label: '设置', click: () => w.webContents.send('shell:action', 'settings') },
                { label: '工具箱', click: () => w.webContents.send('shell:action', 'tools') },
                { label: '终端', click: () => w.webContents.send('shell:action', 'terminal') },
                { type: 'separator' },
                { label: '刷新页面', click: () => toShell('reload') },
                { label: '检查套壳更新', click: () => w.webContents.send('shell:action', 'update') },
                { type: 'separator' },
                { label: '退出', click: () => { isQuitting = true; app.quit(); } },
            ]);
        menu.popup({ window: w });
    });

    // ── Tools 工具箱注册（A/B/C/D 档，全部只读/套壳层）─────────────
    toolsApp = registerAppTools({
        ipcMain, app, dialog, shell, dataRoot, getSettings: loadSettings, saveSettings, terminalWrite,
        win: () => mainWindow,
    });
    toolsData = registerDataTools({
        ipcMain, app, dialog, shell, dataRoot, sillyTavernRoot, terminalWrite,
        win: () => mainWindow, getSettings: loadSettings,
    });
    registerEnvTools({ ipcMain, terminalWrite, dataRoot });
    registerChatTools({ ipcMain, dataRoot, app });
    registerTunnelTools({
        ipcMain, app, terminalWrite,
        getSettings: loadSettings, saveSettings, win: () => mainWindow,
        restartServer: async () => { stopServer(); try { await startServer(); return { success: true }; } catch (e) { return { success: false, error: e.message }; } },
    });
    registerZtTools({ ipcMain, terminalWrite, getSettings: loadSettings, saveSettings });
    // 更新下载完成后保留回滚包
    // 审计 #8：downloadedUpdateHelper 无 installerPath；真实路径是 autoUpdater.installerPath（BaseUpdater 属性）
    autoUpdater.on('update-downloaded', () => {
        if (shellUpdateVersion) {
            try { toolsApp.saveRollbackPackage(shellUpdateVersion, autoUpdater.installerPath || autoUpdater.downloadedUpdateHelper?.installerPath || ''); } catch (_) {}
        }
    });
    ipcMain.handle('shell-update:check', async () => {
        try {
            const result = await autoUpdater.checkForUpdates();
            shellUpdateVersion = result?.updateInfo?.version || null;
            if (!result) return { hasUpdate: false };
            return { version: result.updateInfo.version, hasUpdate: true };
        } catch (e) { return { error: e.message }; }
    });
    ipcMain.handle('shell-update:download', async () => {
        if (!shellUpdateVersion) return { error: '请先点击"检查套壳更新"，确认有新版本后再下载' };
        try {
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (e) { return { error: e.message }; }
    });
    ipcMain.handle('shell-update:install', () => { autoUpdater.quitAndInstall(true, true); });
    autoUpdater.on('download-progress', p => w()?.webContents.send('shell-update:progress', p));
    autoUpdater.on('update-downloaded', () => w()?.webContents.send('shell-update:downloaded'));
    autoUpdater.on('error', e => w()?.webContents.send('shell-update:error', e.message));
}

function copyDir(src, dest) { fs.mkdirSync(dest, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dest, e.name); e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } }

// ── Server ───────────────────────────────────────────────────────────
function migrateDataIfNeeded() {
    const oldData = path.join(sillyTavernRoot, 'data');
    if (!fs.existsSync(oldData) || fs.existsSync(dataRoot)) return;
    try {
        terminalWrite('\x1b[36m> Migrating user data to ' + dataRoot + ' ...\x1b[0m');
        fs.mkdirSync(path.dirname(dataRoot), { recursive: true });
        fs.cpSync(oldData, dataRoot, { recursive: true, force: true });
        terminalWrite('\x1b[32mData migrated. Old copy kept as backup.\x1b[0m');
    } catch (e) { terminalWrite('\x1b[31mData migration failed: ' + e.message + '\x1b[0m'); }
}

function startServer() {
    return new Promise((resolve, reject) => {
        const serverJs = path.join(sillyTavernRoot, 'server.js');
        if (!fs.existsSync(serverJs)) { reject(new Error(`server.js not found at ${serverJs}`)); return; }
        migrateDataIfNeeded();
        // A1 局域网访问：--listen 监听全网卡；basicAuth 凭据走环境变量
        // （ST 1.18 getConfigValue 优先读 env：SILLYTAVERN_BASICAUTHMODE / ...USERNAME / ...PASSWORD，
        //  --basicAuthUser/--basicAuthPassword CLI 参数无效——审计 #5；零写入 ST 文件）
        const s = loadSettings();
        const args = [serverJs, '--dataRoot', dataRoot, '--no-browserLaunchEnabled'];
        // 子进程是 node.exe，不需要 ELECTRON_RUN_AS_NODE；显式删除避免 undefined 被转成 "undefined" 字符串
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        if (s.lanEnabled) {
            args.push('--listen');
            if (s.lanUser && s.lanPass) {
                env.SILLYTAVERN_BASICAUTHMODE = '1';
                env.SILLYTAVERN_BASICAUTHUSER_USERNAME = String(s.lanUser);
                env.SILLYTAVERN_BASICAUTHUSER_PASSWORD = String(s.lanPass);
            }
        }
        terminalWrite('\x1b[36m> node ' + args.join(' ') + (s.lanEnabled && s.lanPass ? ' [basicAuth via env]' : '') + '\x1b[0m');
        serverProcess = spawn('node', args, { cwd: sillyTavernRoot, stdio: ['ignore', 'pipe', 'pipe'], env });
        let started = false, stdoutBuffer = '', timedOut = false;
        const killOnTimeout = setTimeout(() => {
            if (started) return;
            timedOut = true;
            try { serverProcess?.kill('SIGKILL'); } catch (_) {}
            serverProcess = null;
            reject(new Error('Server start timed out after 60s'));
        }, 60000);
        serverProcess.stdout.on('data', data => {
            stdoutBuffer += data.toString(); terminalWrite(data);
            if (started) return;
            const m = stdoutBuffer.replace(/\x1b\[[0-9;]*m/g, '').match(/Go to:\s*(https?:\/\/[^\s]+)/);
            if (m) { started = true; serverUrl = m[1]; clearTimeout(killOnTimeout); mainWindow?.webContents.send('server:url', serverUrl); resolve(); }
        });
        serverProcess.stderr.on('data', data => terminalWrite(data));
        serverProcess.on('error', err => { clearTimeout(killOnTimeout); if (!started) { serverProcess = null; reject(err); } });
        // 审计：ST 崩溃后无感知——启动成功后意外退出 → 通知页面并自动重启（防循环：5 分钟内最多 2 次）
        let lastCrashTs = 0, crashCount = 0;
        serverProcess.on('exit', (code) => {
            clearTimeout(killOnTimeout);
            if (!started && !timedOut && code !== 0) { serverProcess = null; reject(new Error(`Server exited with code ${code}`)); return; }
            serverProcess = null;
            if (started && !isQuitting && code !== 0) {
                const now = Date.now();
                if (now - lastCrashTs < 5 * 60 * 1000) crashCount++; else crashCount = 1;
                lastCrashTs = now;
                mainWindow?.webContents.send('server:error', `ST 服务器异常退出 (code ${code})`);
                terminalWrite(`\x1b[31m[server] SillyTavern 异常退出 (code ${code})\x1b[0m\n`);
                if (crashCount <= 2) {
                    terminalWrite(`\x1b[33m[server] 5 秒后自动重启 (${crashCount}/2)...\x1b[0m\n`);
                    setTimeout(() => { if (!isQuitting) { try { startServer().catch(e => terminalWrite('\x1b[31m[server] 重启失败: ' + e.message + '\x1b[0m\n')); } catch (_) {} } }, 5000);
                } else {
                    terminalWrite('\x1b[31m[server] 连续崩溃，停止自动重启。请查看上方日志或手动重启。\x1b[0m\n');
                }
            }
        });
    });
}

function stopServer() {
    if (serverProcess) { serverProcess.kill('SIGTERM'); const pid = serverProcess.pid; setTimeout(() => { try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (_) {} }, 3000); serverProcess = null; }
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── App Lifecycle ────────────────────────────────────────────────────
app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_w, p, cb) => cb(['clipboard-read', 'clipboard-sanitized-write', 'notifications'].includes(p)));
    // basicAuth 登录弹窗：app.login 事件才是 Electron 的认证事件（Session 没有 login）
    // 仅对本地 ST 地址弹窗/自动登录，防止凭据泄露给任意 Basic Auth 站点（审计 #9）
    app.on('login', (event, _webContents, _details, authInfo, callback) => {
        try {
            const host = String(authInfo?.host || '');
            const isLocal = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(host);
            const s = loadSettings();
            if (!isLocal) { callback(); return; } // 非本地地址：取消认证
            event.preventDefault();
            // Unauthorized 页面重试：shell:auth-retry 存入的一次性凭据优先使用
            if (authOneShot) {
                const one = authOneShot; authOneShot = null;
                callback(String(one.user), String(one.pass));
                return;
            }
            const creds = (s.stAuthUser && s.stAuthPass) ? { user: s.stAuthUser, pass: s.stAuthPass }
                : (s.lanEnabled && s.lanUser && s.lanPass) ? { user: s.lanUser, pass: s.lanPass } : null;
            const now = Date.now();
            if (creds && now - authAutoTriedAt > 5000) {
                // 已保存凭据：先自动登录一次；若失败，5 秒内再次 401 会改为弹窗，避免无限循环
                authAutoTriedAt = now;
                callback(String(creds.user), String(creds.pass));
                return;
            }
            // 同一时间只保留一个待认证请求，避免弹窗叠加
            if (pendingAuth) { try { pendingAuth.callback(); } catch (_) {} }
            pendingAuth = { callback, host };
            if (pendingAuthTimer) clearTimeout(pendingAuthTimer);
            pendingAuthTimer = setTimeout(() => { if (pendingAuth) { try { pendingAuth.callback(); } catch (_) {} pendingAuth = null; pendingAuthTimer = null; } }, 120000);
            mainWindow?.webContents.send('shell:auth-required', { host });
            // 认证结果由 shell:auth-respond 回传后调用 callback
        } catch (_) { callback(); }
    });
    createTray(); createWindow(); setupIPC();
    // Start the chat watcher (read-only token statistics, auto restarts on activate)
    benchStartWatcher();

    // Check if SillyTavern is already installed — skip setup if so
    if (isSillyTavernInstalled()) {
        terminalWrite('\x1b[32mSillyTavern 已安装，跳过下载\x1b[0m');
    } else {
        mainWindow?.webContents.send('setup:started');
        try { await setupSillyTavern(); }
        catch (e) { console.error(e.message); mainWindow?.webContents.send('server:error', 'SillyTavern 安装失败: ' + e.message); return; }
    }

    try { await startServer(); } catch (e) { console.error(e.message); mainWindow?.webContents.send('server:error', e.message); }
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) { createWindow(); setupIPC(); startServer().catch(() => {}); }
        else { mainWindow?.show(); mainWindow?.focus(); }
    });
});
app.on('before-quit', () => { isQuitting = true; stopServer(); try { toolsApp?.markCleanExit?.(); } catch (_) {} });
app.on('will-quit', () => { if (tray) { tray.destroy(); tray = null; } });
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
