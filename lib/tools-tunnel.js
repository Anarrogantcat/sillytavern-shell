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
    let urlTimer = null;
    let lanEnabledBeforeTunnel = null; // 自动开启 LAN 认证前的原状态，停止隧道时恢复
    let state = { running: false, url: '', error: '', available: !!bundledExe() };

    function push() {
        try { win()?.webContents.send('tunnel:state', { ...state }); } catch (_) {}
    }

    function clearUrlTimer() {
        if (urlTimer) { clearTimeout(urlTimer); urlTimer = null; }
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
            lanEnabledBeforeTunnel = !!s.lanEnabled;
            if (!s.lanEnabled) {
                s.lanEnabled = true;
                saveSettings(s);
                terminalWrite('[tunnel] 已自动启用访问认证，正在重启服务器...\n');
                const r = await restartServer();
                if (!r?.success) return { error: '服务器重启失败（启用认证）: ' + (r?.error || '未知错误') };
            }
            // 确认 ST 服务器确实在 8000 端口监听（basicAuth 时返回 401 也算存活）
            try {
                const probe = await fetch('http://127.0.0.1:8000/', { signal: AbortSignal.timeout(4000) });
                if (!probe.ok && probe.status !== 401) return { error: `ST 服务器响应异常 HTTP ${probe.status}` };
            } catch (_) {
                return { error: 'ST 服务器未监听 8000 端口，请先启动服务器再开启隧道' };
            }
            state.url = ''; state.error = '';
            const env = { ...process.env };
            // 自动识别本地 Clash 代理：cloudflared 默认不走系统代理，检测到 7890 时注入代理环境变量
            try {
                const probe = await fetch('http://127.0.0.1:7890', { signal: AbortSignal.timeout(1500) });
                if (probe.status >= 0 && !env.HTTP_PROXY && !env.http_proxy) {
                    env.HTTP_PROXY = 'http://127.0.0.1:7890';
                    env.HTTPS_PROXY = 'http://127.0.0.1:7890';
                    env.ALL_PROXY = 'http://127.0.0.1:7890';
                    env.http_proxy = 'http://127.0.0.1:7890';
                    env.https_proxy = 'http://127.0.0.1:7890';
                    env.all_proxy = 'http://127.0.0.1:7890';
                    terminalWrite('[tunnel] 检测到本地代理 127.0.0.1:7890，cloudflared 将通过代理连接\n');
                }
            } catch (_) {}
            proc = spawn(exe, ['tunnel', '--url', 'http://127.0.0.1:8000', '--no-autoupdate'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
            proc.on('error', (err) => {
                clearUrlTimer();
                proc = null;
                state.running = false; state.error = 'cloudflared 启动失败: ' + err.message;
                terminalWrite(`[tunnel] 启动失败: ${err.message}\n`);
                push();
            });
            proc.stdout.on('data', (d) => {
                const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (m && !state.url) {
                    clearUrlTimer();
                    state.url = m[0]; state.running = true; push();
                    terminalWrite(`[tunnel] ✅ 公网地址: ${m[0]}\n`);
                }
            });
            proc.stderr.on('data', (d) => {
                const t = String(d);
                if (/ERR|error|failed|unable|invalid|timeout/i.test(t)) {
                    terminalWrite('[tunnel] ' + t);
                    // 网络不可达/连接失败时不要一直停留在“开启中”，把错误反馈到状态栏
                    if (!state.url && /error|failed|unable|invalid|timeout|refused/i.test(t)) {
                        clearUrlTimer();
                        state.error = '隧道连接失败，请检查网络/代理 (127.0.0.1:7890): ' + t.trim().slice(0, 160);
                        push();
                    }
                }
            });
            proc.on('exit', (code) => {
                clearUrlTimer();
                proc = null;
                if (state.running || state.url) {
                    state.running = false; state.error = `隧道进程退出 (code ${code})`;
                    terminalWrite(`[tunnel] 隧道已停止 (code ${code})\n`);
                    push();
                }
            });
            // 45 秒内没拿到公网地址就判定失败，避免 UI 一直“开启中”
            urlTimer = setTimeout(() => {
                if (!state.url && proc) {
                    try { proc.kill(); } catch (_) {}
                    proc = null;
                    state.running = false; state.error = '隧道连接超时（45 秒未获得公网地址），请检查网络/代理';
                    terminalWrite('[tunnel] 隧道连接超时\n');
                    push();
                }
                urlTimer = null;
            }, 45000);
            state.running = true; push();
            return { ok: true };
        } catch (e) {
            state.error = e.message; push();
            return { error: e.message };
        }
    }

    function stop() {
        if (proc) { try { proc.kill(); } catch (_) {} proc = null; }
        clearUrlTimer();
        state.running = false; state.url = ''; state.error = ''; push();
        // 如果隧道启动时自动开启了 LAN 认证，则关闭隧道后恢复原状（后台重启服务器使 --listen 失效）
        if (lanEnabledBeforeTunnel === false) {
            const s = getSettings();
            if (s.lanEnabled) {
                s.lanEnabled = false;
                saveSettings(s);
                terminalWrite('[tunnel] 已恢复局域网访问关闭状态，正在重启服务器生效...\n');
                restartServer().then(r => {
                    terminalWrite(r?.success ? '[tunnel] 服务器已重启（LAN 已关闭）\n' : '[tunnel] 服务器重启失败: ' + (r?.error || '未知错误') + '\n');
                }).catch(() => {});
            }
        }
        lanEnabledBeforeTunnel = null;
        return { ok: true };
    }

    function status() { return { ...state }; }

    ipcMain.handle('tools:tunnelStart', async () => { try { return await start(); } catch (e) { return { error: e.message }; } });
    ipcMain.handle('tools:tunnelStop', () => stop());
    ipcMain.handle('tools:tunnelStatus', () => status());

    return { start, stop, status };
}
