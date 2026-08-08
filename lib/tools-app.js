// ── A 档：套壳自身能力（零依赖 ST 内部结构，ST 更新 100% 无感）──
// A1 自动备份 Data | A2 版本回滚 | A3 沉浸/深夜/PIN | A4 托盘增强(调用方)
// A5 开机自启 | A6 便携模式导出
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BACKUP_DEFAULT_DIR = 'E:\\SillyTavernBackup';

export function registerAppTools(ctx) {
    const { ipcMain, app, dialog, shell, dataRoot, getSettings, saveSettings, terminalWrite, win } = ctx;

    // ── A1 自动备份 ────────────────────────────────────────────────
    function backupTarget() {
        const s = getSettings();
        return s.backupDir || BACKUP_DEFAULT_DIR;
    }
    function backupList() {
        const dir = backupTarget();
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter(d => d.startsWith('ST-Data-')).sort().reverse();
    }
    const BACKUP_SKIP = /node_modules|_cache|_webpack|_css|_storage\/(leveldb|databases|chrome|Session|IndexedDB)/;
    function doBackup() {
        const dir = backupTarget();
        if (!fs.existsSync(dataRoot)) throw new Error(`数据目录不存在: ${dataRoot}`);
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);
        const dest = path.join(dir, `ST-Data-${stamp}`);
        fs.cpSync(dataRoot, dest, { recursive: true, filter: src => !BACKUP_SKIP.test(src) });
        const keep = getSettings().backupKeep || 5;
        const all = fs.readdirSync(dir).filter(d => d.startsWith('ST-Data-')).sort();
        while (all.length > keep) fs.rmSync(path.join(dir, all.shift()), { recursive: true, force: true });
        const st = getSettings(); st.backupLast = Date.now(); saveSettings(st);
        terminalWrite(`[backup] 备份完成: ${dest}\n`);
        return dest;
    }
    function backupCheck() { // 启动时 + 每 6h 检查定时备份
        const s = getSettings();
        if (!s.backupAuto || !s.backupDir) return;
        const last = s.backupLast || 0;
        const intervalH = s.backupIntervalH || 24;
        if (Date.now() - last > intervalH * 3600e3) {
            try { doBackup(); } catch (e) { terminalWrite(`[backup] 自动备份失败: ${e.message}\n`); }
        }
    }
    const backupTimer = setInterval(backupCheck, 6 * 3600e3);
    backupTimer.unref?.();

    // ── A2 版本回滚 ────────────────────────────────────────────────
    const rollbackDir = () => path.join(app.getPath('userData'), 'rollback');
    function rollbackList() {
        const dir = rollbackDir();
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter(f => f.endsWith('.exe')).map(f => {
            const m = f.match(/Setup-([\d.]+)\.exe/);
            return { file: f, version: m ? m[1] : f.replace('.exe', '') };
        }).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    }
    function saveRollbackPackage(version, installerPath) {
        try {
            const dir = rollbackDir();
            fs.mkdirSync(dir, { recursive: true });
            const dest = path.join(dir, `SillyTavern-Setup-${version}.exe`);
            if (!fs.existsSync(dest)) { fs.copyFileSync(installerPath, dest); terminalWrite(`[rollback] 已保留 v${version} 安装包\n`); }
        } catch (_) {}
    }
    function rollbackInstall(version) {
        const f = path.join(rollbackDir(), `SillyTavern-Setup-${version}.exe`);
        if (!fs.existsSync(f)) return { error: '回滚包不存在' };
        spawn(f, ['/S', `/D=${path.dirname(app.getPath('exe'))}`], { detached: true, stdio: 'ignore' }).unref();
        terminalWrite(`[rollback] 正在回滚到 v${version}...\n`);
        return { ok: true };
    }

    // ── A3 沉浸 / 深夜 / PIN ────────────────────────────────────────
    function setImmersive(on) {
        const w = win();
        if (w) { w.setFullScreen(!!on); w.setMenuBarVisibility?.(!on); }
        return !!on;
    }
    function nightCheck() { // 每 60s 检查深夜模式时间段
        const s = getSettings();
        if (!s.nightEnabled) { if (s._nightActive) { s._nightActive = false; saveSettings(s); win()?.webContents.send('ui:night', false); } return; }
        const now = new Date();
        const cur = now.getHours() * 60 + now.getMinutes();
        const [sh, sm] = String(s.nightStart || '22:00').split(':').map(Number);
        const [eh, em] = String(s.nightEnd || '07:00').split(':').map(Number);
        const start = sh * 60 + sm, end = eh * 60 + em;
        const active = start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
        if (active !== !!s._nightActive) { s._nightActive = active; saveSettings(s); win()?.webContents.send('ui:night', active); }
    }
    const nightTimer = setInterval(nightCheck, 60000);
    nightTimer.unref?.();
    function verifyPin(code) {
        const s = getSettings();
        return !!s.pin && s.pin === String(code);
    }

    // ── A5 开机自启 ────────────────────────────────────────────────
    function getAutostart() { return app.getLoginItemSettings().openAtLogin; }
    function setAutostart(on) { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath }); return getAutostart(); }

    // ── A6 便携模式导出 ────────────────────────────────────────────
    async function portableExport(targetDir) {
        const base = path.join(targetDir, 'SillyTavern-Portable');
        const dest = path.join(base, 'Data');
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(dataRoot, dest, { recursive: true, filter: src => !BACKUP_SKIP.test(src) });
        fs.writeFileSync(path.join(base, '使用说明.txt'),
            '【SillyTavern 便携包】\n' +
            '1. 把套壳安装目录 D:\\AI\\SillyTavern 整个复制到本目录\n' +
            '   （本目录已有 Data，覆盖时保留本 Data）\n' +
            '2. 运行 Shell\\SillyTavern.exe\n' +
            '3. 聊天数据都在本目录 Data 下，插到任何电脑即可用\n', 'utf8');
        return base;
    }

    // ── IPC 注册 ───────────────────────────────────────────────────
    ipcMain.handle('tools:backupNow', () => { try { return { ok: true, dest: doBackup() }; } catch (e) { return { error: e.message }; } });
    ipcMain.handle('tools:backupList', () => backupList());
    ipcMain.handle('tools:backupConfig', () => { const s = getSettings(); return { dir: s.backupDir || '', auto: !!s.backupAuto, intervalH: s.backupIntervalH || 24, keep: s.backupKeep || 5, last: s.backupLast || 0 }; });
    ipcMain.handle('tools:backupSave', (e, cfg) => {
        const s = getSettings();
        if (cfg.dir !== undefined) s.backupDir = String(cfg.dir);
        if (cfg.auto !== undefined) s.backupAuto = !!cfg.auto;
        if (cfg.intervalH !== undefined) s.backupIntervalH = Number(cfg.intervalH) || 24;
        if (cfg.keep !== undefined) s.backupKeep = Math.min(20, Math.max(1, Number(cfg.keep) || 5));
        saveSettings(s);
        if (s.backupAuto) { try { doBackup(); } catch (_) {} }
        return true;
    });
    ipcMain.handle('tools:rollbackList', () => rollbackList());
    ipcMain.handle('tools:rollbackInstall', (e, v) => rollbackInstall(v));
    ipcMain.handle('tools:autostartGet', () => getAutostart());
    ipcMain.handle('tools:autostartSet', (e, on) => setAutostart(on));
    ipcMain.handle('tools:immerseSet', (e, on) => setImmersive(on));
    ipcMain.handle('tools:nightGet', () => { const s = getSettings(); return { enabled: !!s.nightEnabled, start: s.nightStart || '22:00', end: s.nightEnd || '07:00' }; });
    ipcMain.handle('tools:nightSave', (e, cfg) => {
        const s = getSettings();
        s.nightEnabled = !!cfg.enabled; s.nightStart = cfg.start || '22:00'; s.nightEnd = cfg.end || '07:00';
        saveSettings(s); nightCheck(); return true;
    });
    ipcMain.handle('tools:pinGet', () => { const s = getSettings(); return { hasPin: !!s.pin }; });
    ipcMain.handle('tools:pinSet', (e, code) => {
        const s = getSettings();
        if (!code) delete s.pin; else s.pin = String(code);
        saveSettings(s); return true;
    });
    ipcMain.handle('tools:pinVerify', (e, code) => verifyPin(code));
    ipcMain.handle('tools:portablePick', async () => {
        const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择便携包导出位置' });
        if (r.canceled || !r.filePaths[0]) return { canceled: true };
        try { return { canceled: false, dest: await portableExport(r.filePaths[0]) }; }
        catch (e) { return { canceled: false, error: e.message }; }
    });

    return { doBackup, backupList, saveRollbackPackage, rollbackList, rollbackInstall, setImmersive, getAutostart, setAutostart, verifyPin, backupCheck };
}
