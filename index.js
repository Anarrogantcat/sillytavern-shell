import { app, BrowserWindow, ipcMain, session, Tray, Menu, nativeImage, dialog, shell, Notification } from 'electron';
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
const defaultST = app.isPackaged ? path.join(path.dirname(process.resourcesPath), '..', 'SillyTavern') : path.resolve(__dirname, '../..');
if (!settings.serverPath) { settings.serverPath = defaultST; saveSettings(settings); }
else if (/[\\/]resources[\\/]sillytavern$/i.test(settings.serverPath)) {
    // Old layout (ST inside shell resources) — migrate to sibling dir
    settings.serverPath = path.join(path.dirname(settings.serverPath), '..', '..', 'SillyTavern');
    saveSettings(settings);
}
const sillyTavernRoot = cliArguments.serverPath || settings.serverPath || defaultST;
// User data lives OUTSIDE resources — upgrade/reinstall never touches it
const dataRoot = settings.dataRoot || (app.isPackaged
    ? path.join(path.dirname(process.resourcesPath), '..', 'Data')
    : path.join(path.resolve(__dirname, '../..'), 'Data'));

// ── Git safe.directory ────────────────────────────────────────────
// After a Windows reinstall (new user SID) git refuses to touch repos owned
// by the old account ("dubious ownership"), which breaks ST update (git pull)
// and the integrity check (git ls-files). Add the ST root as safe once, at
// startup, so both features keep working across reinstall/relocation.
(function ensureGitSafeDir() {
    try {
        const cwd = sillyTavernRoot;
        if (!fs.existsSync(path.join(cwd, '.git'))) return; // not a git repo — nothing to do
        const existing = execSync('git config --global --get-all safe.directory', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().split('\n').map(s => s.trim()).filter(Boolean);
        if (!existing.includes(cwd)) {
            execSync(`git config --global --add safe.directory "${cwd}"`, { stdio: 'ignore' });
            terminalWrite(`[git] added safe.directory ${cwd}\n`);
        }
    } catch (_) { /* non-fatal */ }
})();

// ── Model Benchmark (测速 + 对话 Token 统计 + 建议) ─────────────
// 只读 ST 数据（settings.json / 聊天记录），零写入本体，不依赖 ST 内部 API。
// 自动监听当前角色卡的聊天文件：消息生成完成（写盘）→ 统计 Token；
// 10 分钟窗口分组为"一次对话"，记满 3 次后结合硬件与实测速度给建议。
const BENCH_SESSION_WINDOW_MS = 10 * 60 * 1000;
const BENCH_MAX_SESSIONS = 3;
const benchState = {
    activeCharacter: null,
    model: null,
    hardware: null,
    sessions: [],        // [{total, reply, lastTs}] 已结束的对话
    current: null,       // 进行中的对话 {total, reply, lastTs}
    benchmark: null,     // 最近测速结果
    suggestion: null,    // 最近建议
    benchTimer: null,    // 10s 轮询扫描定时器
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
function benchGetHardware(cb) {
    // ASYNC: never block the main process (execSync nvidia-smi/powershell can stall 5-13s)
    const result = {
        cpu: (os.cpus()[0]?.model || 'Unknown CPU').trim(),
        memGB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
        gpu: '', vramGB: 0,
    };
    const finish = () => { benchState.hardware = result; cb?.(result); };
    exec('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (!err && stdout) {
            const [name, mem] = stdout.trim().split(',').map(x => x.trim());
            result.gpu = name || '';
            result.vramGB = Math.round((parseFloat(mem) / 1024) * 10) / 10;
            return finish();
        }
        exec('powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Where-Object {$_.Name -match \'NVIDIA|AMD|RTX|Radeon\'} | Select-Object -First 1).Name"', { timeout: 8000, windowsHide: true }, (err2, out2) => {
            if (!err2 && out2) result.gpu = out2.trim();
            finish();
        });
    });
}
async function benchTokenize(text) {
    const { url, model } = benchState.model || {};
    if (url && model && benchIsOllama(url)) {
        try {
            const r = await fetch(benchOllamaBase(url) + '/api/tokenize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt: String(text || '') }), signal: AbortSignal.timeout(15000) });
            if (r.ok) { const j = await r.json(); return j.count || 0; }
        } catch (_) {}
    }
    const t = String(text || '');
    let cjk = 0, other = 0;
    for (const ch of t) { if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) cjk++; else other++; }
    return Math.max(1, Math.round(cjk / 1.5 + other / 4));
}
async function benchGenerateOnce(numPredict = 128) {
    const { url, model } = benchState.model || {};
    if (!url || !model) throw new Error('未检测到模型配置');
    if (benchIsOllama(url)) {
        const t0 = Date.now();
        const r = await fetch(benchOllamaBase(url) + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt: 'Write a short story about a curious cat exploring a lighthouse. ', stream: false, options: { num_predict: numPredict, temperature: 0.6 } }), signal: AbortSignal.timeout(180000) });
        if (!r.ok) throw new Error(`generate HTTP ${r.status}`);
        const j = await r.json();
        const evalMs = (j.eval_duration || 0) / 1e6;
        const tok = j.eval_count || 0;
        return { tokPerSec: evalMs > 0 ? Math.round((tok / (evalMs / 1000)) * 10) / 10 : 0, tok, evalMs: Math.round(evalMs), totalMs: Date.now() - t0, ttftMs: Math.round(((j.total_duration || 0) - (j.eval_duration || 0)) / 1e6) };
    }
    const t0 = Date.now();
    const r = await fetch(String(url).replace(/\/+$/, '') + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Write a short story about a curious cat. ' }], max_tokens: 64, stream: false }), signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`chat/completions HTTP ${r.status}`);
    const j = await r.json();
    const tok = j.usage?.completion_tokens || 0;
    const ms = Date.now() - t0;
    return { tokPerSec: ms > 0 && tok > 0 ? Math.round((tok / (ms / 1000)) * 10) / 10 : 0, tok, evalMs: ms, totalMs: ms, ttftMs: ms };
}
async function benchGetModelContext() {
    const { url, model } = benchState.model || {};
    if (!url || !model) return null;
    if (benchIsOllama(url)) {
        try {
            const r = await fetch(benchOllamaBase(url) + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(15000) });
            if (r.ok) {
                const j = await r.json();
                const mi = j.model_info || {};
                const ctx = mi['general.context_length'] ?? mi['llama.context_length'] ?? mi['qwen2.context_length'];
                if (ctx) return ctx;
            }
        } catch (_) {}
    }
    const c = benchGetSettings().oai_settings?.openai_max_context;
    return typeof c === 'number' && c > 0 ? c : null;
}
async function benchRunBenchmark() {
    const runs = [];
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
        try { runs.push(await benchGenerateOnce()); } catch (e) { lastErr = e; }
        if (i < 2) await new Promise(r => setTimeout(r, 300));
    }
    if (!runs.length) throw lastErr || new Error('测速失败');
    runs.sort((a, b) => a.tokPerSec - b.tokPerSec);
    const med = runs[Math.floor(runs.length / 2)];
    const modelCtx = await benchGetModelContext();
    benchState.benchmark = { ...med, runs: runs.map(r => r.tokPerSec), modelCtx };
    benchState.suggestion = benchComputeSuggestion(med.tokPerSec, modelCtx);
    return benchState.benchmark;
}
function benchComputeSuggestion(tokPerSec, modelCtxLimit) {
    const sessions = [...benchState.sessions];
    if (benchState.current && benchState.current.total > 0) sessions.push(benchState.current);
    const totalHistory = sessions.reduce((a, s) => a + s.total, 0);
    const replyToks = sessions.filter(s => s.reply > 0).map(s => s.reply);
    const maxReply = replyToks.length ? Math.max(...replyToks) : 512;
    const vramGB = benchState.hardware?.vramGB || 0;
    const baseOverhead = 1200; // 系统提示 + 角色卡 + 世界书 估算
    const need = baseOverhead + totalHistory + maxReply;
    const ctxByNeed = Math.max(4096, Math.ceil((need * 1.25) / 100) * 100); // 至少 4K
    const ctxByModel = modelCtxLimit ? Math.floor((modelCtxLimit * 0.75) / 100) * 100 : Infinity;
    const ctxByVram = vramGB > 0 ? Math.floor((vramGB * 2048) / 100) * 100 : Infinity;
    const suggestCtx = Math.min(ctxByNeed, ctxByModel, ctxByVram);
    const respByUsage = Math.ceil((maxReply * 1.1) / 50) * 50;
    const respBySpeed = tokPerSec > 0 ? Math.floor((tokPerSec * 60) / 50) * 50 : Infinity;
    const respByCtx = Math.max(512, Math.floor((suggestCtx / 8) / 50) * 50); // 至少 512
    const suggestResp = Math.min(respByUsage, respBySpeed, respByCtx);
    return { suggestCtx, suggestResp, totalHistory, maxReply, baseOverhead, ctxByNeed, ctxByModel, ctxByVram, respByUsage, respBySpeed, respByCtx, sessionsCount: sessions.length };
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
    files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
    return path.join(dir, files[0]);
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
    let buf;
    try { buf = fs.readFileSync(f); } catch (_) { return; }
    const prev = benchState.fileBytes.get(f);
    if (prev === undefined || buf.length <= prev) {
        // First sight, or file rewritten (new chat) — reset baseline, count nothing
        benchState.fileBytes.set(f, buf.length);
        return;
    }
    benchState.fileBytes.set(f, buf.length);
    for (const line of buf.slice(prev).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        let msg = null;
        try { msg = JSON.parse(line); } catch (_) { continue; }
        if (!msg || msg.chat_metadata || !msg.mes) continue;
        benchQueueTokenize(msg);
    }
}
function benchStartWatcher() {
    benchStopWatcher();
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
        if (!msg.is_user) benchState.current.reply += count;
        benchState.current.lastTs = Math.max(benchState.current.lastTs, sendTs);
        if (benchState.sessions.length + (benchState.current ? 1 : 0) >= BENCH_MAX_SESSIONS) {
            benchState.suggestion = benchComputeSuggestion(benchState.benchmark?.tokPerSec || 0, benchState.benchmark?.modelCtx ?? null);
        }
    }).catch(() => {});
}
function benchGetStatus() {
    if (!benchState.hardware) benchGetHardware(); // async — never blocks
    if (!benchState.model) benchState.model = benchDetectModel();
    benchScanOnce(); // pick up character/chat changes immediately when the panel opens
    const sessions = [...benchState.sessions];
    if (benchState.current && benchState.current.total > 0) sessions.push({ ...benchState.current, active: true });
    return {
        activeCharacter: benchState.activeCharacter,
        model: benchState.model,
        hardware: benchState.hardware,
        sessions,
        benchmark: benchState.benchmark,
        suggestion: benchState.suggestion,
    };
}

// ── SillyTavern Setup (first launch) ─────────────────────────────────
function isSillyTavernInstalled() {
    return fs.existsSync(path.join(sillyTavernRoot, 'server.js'));
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
    for (const line of lines) { if (line) terminalLines.push(line); }
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
    try { if (fs.existsSync(STATE_PATH)) { const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); if (d && typeof d.width === 'number') return d; } } catch (_) {}
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
        { label: '退出', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── Window ───────────────────────────────────────────────────────────
let mainWindow = null, serverProcess = null, serverUrl = null;
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

    ipcMain.handle('settings:get', () => settings);
    ipcMain.handle('settings:save', (_e, s) => { Object.assign(settings, s); saveSettings(settings); });
    ipcMain.handle('settings:getServerPath', () => sillyTavernRoot);
    ipcMain.handle('settings:setServerPath', (_e, p) => { settings.serverPath = p; saveSettings(settings); });
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
    // ── Model Benchmark IPC ──────────────────────────────────────────
    ipcMain.handle('bench:status', () => benchGetStatus());
    ipcMain.handle('bench:benchmark', async () => {
        try { return await benchRunBenchmark(); }
        catch (e) { return { error: e.message }; }
    });
    ipcMain.handle('bench:reset', () => {
        benchState.sessions = []; benchState.current = null; benchState.suggestion = null;
        return true;
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
        terminalWrite('\x1b[36m> node server.js --dataRoot "' + dataRoot + '" --no-browserLaunchEnabled\x1b[0m');
        serverProcess = spawn('node', [serverJs, '--dataRoot', dataRoot, '--no-browserLaunchEnabled'], { cwd: sillyTavernRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
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
        serverProcess.on('exit', code => { clearTimeout(killOnTimeout); if (!started && !timedOut && code !== 0) { serverProcess = null; reject(new Error(`Server exited with code ${code}`)); } serverProcess = null; });
    });
}

function stopServer() {
    if (serverProcess) { serverProcess.kill('SIGTERM'); const pid = serverProcess.pid; setTimeout(() => { try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (_) {} }, 3000); serverProcess = null; }
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── App Lifecycle ────────────────────────────────────────────────────
app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_w, p, cb) => cb(['clipboard-read', 'clipboard-sanitized-write', 'notifications'].includes(p)));
    createTray(); createWindow(); setupIPC();
    // Start the model-benchmark chat watcher (read-only, auto restarts on activate)
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
app.on('before-quit', () => { isQuitting = true; stopServer(); });
app.on('will-quit', () => { if (tray) { tray.destroy(); tray = null; } });
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
