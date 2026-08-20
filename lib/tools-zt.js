// ── ZeroTier 助手（开源免费，虚拟局域网方案）──
// 只通过 zerotier-cli 控制，不修改 ST 本体，不影响 Clash 代理配置
import fs from 'node:fs';
import { exec } from 'node:child_process';

const CLI_CANDIDATES = [
    'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.exe',
    'C:\\Program Files\\ZeroTier\\One\\zerotier-cli.exe',
    'zerotier-cli',
];

function findCli() {
    for (const c of CLI_CANDIDATES) {
        if (c === 'zerotier-cli') return c;
        try { if (fs.existsSync(c)) return c; } catch (_) {}
    }
    return null;
}

function cliBase() {
    const cli = findCli();
    if (!cli) return 'zerotier-cli';
    return cli.includes('\\') ? `"${cli}"` : cli;
}

function run(cmd, timeout = 8000) {
    return new Promise((resolve) => {
        exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
            resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim() });
        });
    });
}

export function registerZtTools(ctx) {
    const { ipcMain, terminalWrite, getSettings, saveSettings } = ctx;

    async function status() {
        const cli = findCli();
        if (!cli) return { installed: false, running: false, networks: [], ip: '', clashTun: false, error: '未检测到 ZeroTier' };
        const info = await run(`${cliBase()} info`);
        const running = info.ok && /200 info/i.test(info.out);
        let networks = [];
        let ip = '';
        if (running) {
            const list = await run(`${cliBase()} listnetworks`);
            networks = list.out.split(/\r?\n/).filter(Boolean).map((line) => {
                // 兼容不同 zerotier-cli 输出格式：核心是找到 16 位网络 ID 和 IP
                const idMatch = line.match(/([0-9a-fA-F]{16})/);
                if (!idMatch) return null;
                const id = idMatch[1];
                const ipMatches = line.match(/(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d+)?)/g) || [];
                const statusMatch = line.match(/\b(OK|ACCESS_DENIED|REQUESTING_CONFIGURATION|PRIVATE|PUBLIC)\b/i);
                const tokens = line.replace(/^.*?listnetworks\s+/, '').split(/\s+/);
                const name = tokens.find(t => t && t !== id && !/^[0-9a-fA-F:]{2,}$/.test(t) && !/^\d{1,3}\./.test(t) && !/^(OK|ACCESS_DENIED|REQUESTING_CONFIGURATION|PRIVATE|PUBLIC)$/i.test(t)) || '';
                return { id, name, status: statusMatch ? statusMatch[1] : '', ip: ipMatches[0] || '' };
            }).filter(Boolean);
            const firstIp = networks.map(n => n.ip).find(Boolean) || '';
            ip = (firstIp.match(/(\d{1,3}(?:\.\d{1,3}){3})/) || [])[0] || '';
        }
        let clashTun = false;
        try {
            const r = await fetch('http://127.0.0.1:7890', { signal: AbortSignal.timeout(1500) });
            clashTun = r.status >= 0;
        } catch (_) {}
        return { installed: true, running, networks, ip, clashTun };
    }

    async function join(networkId) {
        const cli = findCli();
        if (!cli) return { error: '未检测到 ZeroTier，请先安装客户端' };
        const id = String(networkId || '').trim();
        if (!/^[0-9a-fA-F]{16}$/.test(id)) return { error: '网络 ID 格式不正确（16 位十六进制）' };
        const r = await run(`${cliBase()} join ${id}`, 15000);
        if (!r.ok) return { error: r.err || r.out || '加入失败' };
        const s = getSettings(); s.ztNetworkId = id; saveSettings(s);
        terminalWrite(`[zerotier] 已加入网络 ${id}\n`);
        return { ok: true };
    }

    async function leave(networkId) {
        const cli = findCli();
        if (!cli) return { error: '未检测到 ZeroTier' };
        const id = String(networkId || '').trim();
        if (!/^[0-9a-fA-F]{16}$/.test(id)) return { error: '网络 ID 格式不正确（16 位十六进制）' };
        const r = await run(`${cliBase()} leave ${id}`, 15000);
        if (!r.ok) return { error: r.err || r.out || '离开失败' };
        terminalWrite(`[zerotier] 已离开网络 ${id}\n`);
        return { ok: true };
    }

    ipcMain.handle('tools:ztStatus', async () => status());
    ipcMain.handle('tools:ztJoin', async (e, id) => join(id));
    ipcMain.handle('tools:ztLeave', async (e, id) => leave(id));

    return { status, join, leave };
}
