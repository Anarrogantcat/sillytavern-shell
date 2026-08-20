// 🌐 Cloudflare 公网隧道（开源免费，quick tunnel 免注册）
// 融合进套壳：cloudflared 随安装包分发（extraResources → resources/cloudflared.exe）
// 设置面板开关 → 启动隧道 → 显示公网地址
// 安全：开启前提 = 已设置访问密码（basicAuth）；无密码拒绝开启
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function registerTunnelTools(ctx) {
    const { ipcMain, app, terminalWrite, getSettings, saveSettings, win, restartServer } = ctx;
    // 打包位置：resources/cloudflared.exe（extraResources）；兜底 userData 旧版
    const bundledExe = () => {
        const p = path.join(process.resourcesPath, 'cloudflared.exe');
        if (fs.existsSync(p)) return p;
        const legacy = path.join(app.getPath('userData'), 'cloudflared.exe');
        return fs.existsSync(legacy) ? legacy : null;
    };
    let proc = null;
    let state = { running: false, url: '', error: '', available: !!bundledExe() };

    function push() {
        try { win()?.webContents.send('tunnel:state', { ...state }); } catch (_) {}
    }

    async function start() {
        const s = getSettings();
        // 安全前提：必须已设置访问密码
        if (!s.lanUser || !s.lanPass) {
            return { error: '请先在「局域网访问」设置账号密码（公网隧道必须带认证）' };
        }
        const exe = bundledExe();
        if (!exe) {
            state.error = 'cloudflared 未随安装包分发（构建时缺失）';
            push();
            return { error: state.error };
        }
        if (proc) return { ok: true, url: state.url };
        try {
            // 服务器需带 basicAuth：lanEnabled 未开时自动开启并重启
            if (!s.lanEnabled) {
                s.lanEnabled = true;
                saveSettings(s);
                terminalWrite('[tunnel] 已自动启用访问认证，正在重启服务器...\n');
                const r = await restartServer();
                if (!r?.success) return { error: '服务器重启失败（启用认证）: ' + (r?.error || '未知错误') };
            }
            state.url = ''; state.error = '';
            proc = spawn(exe, ['tunnel', '--url', 'http://127.0.0.1:8000', '--no-autoupdate'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            proc.stdout.on('data', (d) => {
                const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (m && !state.url) {
                    state.url = m[0]; state.running = true; push();
                    terminalWrite(`[tunnel] ✅ 公网地址: ${m[0]}\n`);
                }
            });
            proc.stderr.on('data', (d) => {
                const t = String(d);
                if (/ERR|error|failed|unable|invalid/i.test(t)) terminalWrite('[tunnel] ' + t);
            });
            proc.on('exit', (code) => {
                proc = null;
                if (state.running || state.url) {
                    state.running = false; state.error = `隧道进程退出 (code ${code})`;
                    terminalWrite(`[tunnel] 隧道已停止 (code ${code})\n`);
                    push();
                }
            });
            state.running = true; push();
            return { ok: true };
        } catch (e) {
            state.error = e.message; push();
            return { error: e.message };
        }
    }

    function stop() {
        if (proc) { try { proc.kill(); } catch (_) {} proc = null; }
        state.running = false; state.url = ''; state.error = ''; push();
        return { ok: true };
    }

    function status() { return { ...state }; }

    ipcMain.handle('tools:tunnelStart', async () => { try { return await start(); } catch (e) { return { error: e.message }; } });
    ipcMain.handle('tools:tunnelStop', () => stop());
    ipcMain.handle('tools:tunnelStatus', () => status());

    return { start, stop, status };
}
