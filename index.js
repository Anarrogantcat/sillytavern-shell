import { app, BrowserWindow, ipcMain, session, Tray, Menu, nativeImage, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, exec } from 'node:child_process';
import https from 'node:https';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;

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
// Default closeBehavior to 'ask' — first close always asks
if (settings.closeBehavior === undefined || settings.closeBehavior === 'tray') {
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

// ── Terminal buffer ──────────────────────────────────────────────────
let terminalLines = [];
function terminalWrite(text) {
    const lines = text.toString().split('\n');
    for (const line of lines) { if (line) terminalLines.push(line); }
    while (terminalLines.length > TERMINAL_RING_SIZE) terminalLines.shift();
    mainWindow?.webContents.send('terminal:output', text.toString());
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
        if (behavior === 'tray') { mainWindow.hide(); }
        else if (behavior === 'quit') { isQuitting = true; app.quit(); }
        else {
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'question', title: '关闭 SillyTavern',
                message: '关闭窗口时如何处理？',
                detail: '你可以随时在设置中更改此选项。',
                buttons: ['最小化到托盘', '直接退出', '取消'],
                defaultId: 0, cancelId: 2,
            });
            if (choice === 0) { settings.closeBehavior = 'tray'; saveSettings(settings); mainWindow.hide(); }
            else if (choice === 1) { settings.closeBehavior = 'quit'; saveSettings(settings); isQuitting = true; app.quit(); }
        }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC ──────────────────────────────────────────────────────────────
function setupIPC() {
    const w = () => mainWindow;
    ipcMain.handle('window:minimize', () => w()?.minimize());
    ipcMain.handle('window:maximize', () => { if (w()?.isMaximizable()) w().isMaximized() ? w().unmaximize() : w().maximize(); });
    ipcMain.handle('window:close', () => w()?.close());
    ipcMain.handle('window:isMaximized', () => w()?.isMaximized() ?? false);
    ipcMain.handle('shell:openExternal', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) require('electron').shell.openExternal(url); });
    w()?.on('maximize', () => w()?.webContents.send('window:maximizeChange', true));
    w()?.on('unmaximize', () => w()?.webContents.send('window:maximizeChange', false));

    ipcMain.handle('settings:get', () => settings);
    ipcMain.handle('settings:save', (_e, s) => { Object.assign(settings, s); saveSettings(settings); });
    ipcMain.handle('settings:getServerPath', () => sillyTavernRoot);
    ipcMain.handle('settings:setServerPath', (_e, p) => { settings.serverPath = p; saveSettings(settings); });
    ipcMain.handle('settings:getDataRoot', () => dataRoot);

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
        try { await startServer(); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
    });

    // Shell auto-update
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    ipcMain.handle('shell-update:check', async () => {
        try {
            const result = await autoUpdater.checkForUpdates();
            if (!result) return { hasUpdate: false };
            return { version: result.updateInfo.version, hasUpdate: true };
        } catch (e) { return { error: e.message }; }
    });
    ipcMain.handle('shell-update:download', async () => {
        try {
            const check = await autoUpdater.checkForUpdates();
            if (!check) return { error: '没有可用更新' };
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (e) { return { error: e.message }; }
    });
    ipcMain.handle('shell-update:install', () => { autoUpdater.quitAndInstall(); });
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
        let started = false, stdoutBuffer = '';
        serverProcess.stdout.on('data', data => {
            stdoutBuffer += data.toString(); terminalWrite(data);
            if (started) return;
            const m = stdoutBuffer.replace(/\x1b\[[0-9;]*m/g, '').match(/Go to:\s*(https?:\/\/[^\s]+)/);
            if (m) { started = true; serverUrl = m[1]; mainWindow?.webContents.send('server:url', serverUrl); resolve(); }
        });
        serverProcess.stderr.on('data', data => terminalWrite(data));
        serverProcess.on('error', err => { if (!started) reject(err); });
        serverProcess.on('exit', code => { if (!started && code !== 0) reject(new Error(`Server exited with code ${code}`)); serverProcess = null; });
        setTimeout(() => { if (!started) reject(new Error('Server start timed out after 60s')); }, 60000);
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
