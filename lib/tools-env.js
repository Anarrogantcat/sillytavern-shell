// ── C 档：外部环境能力（与 ST 无交集）──
// C12 一键环境体检 | C13 Ollama 模型面板 | C14 显存/温度监控 | C15 Clash 代理状态
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

export function registerEnvTools(ctx) {
    const { ipcMain, terminalWrite } = ctx;
    const execP = (cmd, timeout = 8000) => new Promise(res => {
        exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => res({ ok: !err, out: (stdout || stderr || '').toString().trim() }));
    });

    // ── C12 一键环境体检 ───────────────────────────────────────────
    async function envCheck() {
        const checks = [];
        // git
        const git = await execP('git --version');
        checks.push({ name: 'Git', ok: git.ok, detail: git.ok ? git.out : '未安装' });
        // node
        const node = await execP('node --version');
        checks.push({ name: 'Node.js', ok: node.ok, detail: node.ok ? node.out : '未安装' });
        // Ollama
        try {
            const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(4000) });
            const j = await r.json();
            checks.push({ name: 'Ollama', ok: true, detail: `在线，${(j.models || []).length} 个模型` });
        } catch (_) {
            checks.push({ name: 'Ollama', ok: false, detail: '不可达 (localhost:11434)' });
        }
        // ST 服务器端口
        try {
            const r = await fetch('http://127.0.0.1:8000/', { signal: AbortSignal.timeout(4000) });
            checks.push({ name: 'ST 服务器 (8000)', ok: true, detail: `HTTP ${r.status}` });
        } catch (_) {
            checks.push({ name: 'ST 服务器 (8000)', ok: false, detail: '未监听或不可达' });
        }
        // 磁盘空间 (D/E)
        for (const drive of ['D:', 'E:']) {
            try {
                const out = await execP(`powershell -NoProfile -Command "(Get-PSDrive -Name ${drive[0]}).Free/1GB"`);
                if (out.ok) checks.push({ name: `磁盘 ${drive}`, ok: true, detail: `剩余 ${Math.round(parseFloat(out.out) * 10) / 10} GB` });
            } catch (_) {}
        }
        // Clash 代理
        const clash = await checkClash();
        checks.push({ name: 'Clash 代理 (7890)', ok: clash, detail: clash ? '在线' : '不可达' });
        // 火绒
        const hr = await execP('powershell -NoProfile -Command "(Get-Process -Name HipsTray,HipsDaemon,HipsMain -ErrorAction SilentlyContinue | Measure-Object).Count"');
        checks.push({ name: '火绒', ok: hr.ok && hr.out !== '0' && hr.out !== '', detail: hr.ok && hr.out !== '0' && hr.out !== '' ? '运行中' : '未检测到' });
        return checks;
    }

    // ── C13 Ollama 模型面板 ────────────────────────────────────────
    async function ollamaModels() {
        try {
            const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(5000) });
            if (!r.ok) return { error: `HTTP ${r.status}` };
            const j = await r.json();
            const models = (j.models || []).map(m => ({
                name: m.name, sizeGB: Math.round((m.size / 2 ** 30) * 10) / 10,
                params: m.details?.parameter_size || '', quant: m.details?.quantization_level || '',
                family: m.details?.family || '', modified: m.modified_at || '',
            }));
            return { models };
        } catch (e) { return { error: 'Ollama 不可达: ' + e.message }; }
    }
    async function ollamaPs() {
        try {
            const r = await fetch('http://localhost:11434/api/ps', { signal: AbortSignal.timeout(5000) });
            if (!r.ok) return { error: `HTTP ${r.status}` };
            const j = await r.json();
            return { models: (j.models || []).map(m => ({ name: m.name, sizeVRAM: Math.round((m.size_vram / 2 ** 30) * 10) / 10 })) };
        } catch (e) { return { error: e.message }; }
    }
    async function ollamaAction(action, model) {
        try {
            const r = await fetch(`http://localhost:11434/api/${action}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, keep_alive: action === 'load' ? -1 : 0 }),
                signal: AbortSignal.timeout(120000),
            });
            return r.ok ? { ok: true } : { error: `HTTP ${r.status}` };
        } catch (e) { return { error: e.message }; }
    }

    // ── C14 显存/温度监控 ──────────────────────────────────────────
    async function gpuStats() {
        const out = await execP('nvidia-smi --query-gpu=memory.used,memory.total,temperature.gpu,utilization.gpu --format=csv,noheader,nounits', 5000);
        if (!out.ok || !out.out) return null;
        const [used, total, temp, util] = out.out.split(',').map(s => parseFloat(s.trim()));
        return { usedGB: Math.round(used / 1024 * 10) / 10, totalGB: Math.round(total / 1024 * 10) / 10, temp, util: Math.round(util) };
    }

    // ── C15 Clash 代理状态 ─────────────────────────────────────────
    async function checkClash() {
        try {
            const r = await fetch('http://127.0.0.1:7890', { signal: AbortSignal.timeout(3000) });
            return r.status >= 0;
        } catch (_) { return false; }
    }

    // ── IPC ────────────────────────────────────────────────────────
    ipcMain.handle('tools:envCheck', async () => envCheck());
    ipcMain.handle('tools:ollamaModels', async () => ollamaModels());
    ipcMain.handle('tools:ollamaPs', async () => ollamaPs());
    ipcMain.handle('tools:ollamaAction', (e, a, m) => ollamaAction(a, m));
    ipcMain.handle('tools:gpuStats', async () => gpuStats());
    ipcMain.handle('tools:clashCheck', async () => checkClash());

    return { envCheck, ollamaModels, gpuStats, checkClash };
}
