// tools-plugins.js — 工具箱声明式插件（用户目录 shell-tools/*.json）
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const MAX_TOOLS = 200;
const MAX_LABEL = 60;
const CMD_TIMEOUT_MS = 60000;
const MAX_BUFFER = 1024 * 1024;
const TYPES = new Set(['command', 'url', 'openPath', 'copy', 'info']);

export function registerPluginTools(ctx) {
    const { ipcMain, app, terminalWrite, shell, clipboard } = ctx;
    const dir = path.join(app.getPath('userData'), 'shell-tools');

    function ensureDir() {
        try {
            fs.mkdirSync(dir, { recursive: true });
            const readme = path.join(dir, 'README.md');
            if (!fs.existsSync(readme)) fs.writeFileSync(readme, README_TEXT, 'utf8');
        } catch (_) {}
    }
    ensureDir();

    function sanitizeTool(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const type = String(raw.type || '').trim();
        if (!TYPES.has(type)) return null;
        const label = String(raw.label || raw.name || '').trim().slice(0, MAX_LABEL);
        if (!label) return null;
        const tool = { label, type };
        if (type === 'command') {
            const command = String(raw.command || '').trim();
            if (!command) return null;
            tool.command = command.slice(0, 4000);
            if (raw.cwd) tool.cwd = String(raw.cwd).slice(0, 1000);
        } else if (type === 'url') {
            const url = String(raw.url || '').trim();
            if (!/^https?:\/\//i.test(url)) return null;
            tool.url = url.slice(0, 2000);
        } else if (type === 'openPath') {
            const p = String(raw.path || '').trim();
            if (!p) return null;
            tool.path = p.slice(0, 2000);
        } else {
            tool.text = String(raw.text || '').slice(0, 4000);
        }
        return tool;
    }

    function listPlugins() {
        ensureDir();
        const groups = [];
        const errors = [];
        let files = [];
        try {
            files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
        } catch (e) { errors.push('读取插件目录失败: ' + e.message); }
        for (const file of files) {
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
                const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.tools) ? raw.tools : null);
                if (!list) { errors.push(file + ': 缺少 tools 数组'); continue; }
                const groupName = String(raw?.group || path.basename(file, '.json')).slice(0, MAX_LABEL);
                const tools = list.map(sanitizeTool).filter(Boolean).slice(0, MAX_TOOLS);
                if (!tools.length) { errors.push(file + ': 没有可用工具'); continue; }
                groups.push({ name: groupName, tools });
            } catch (e) { errors.push(file + ': ' + e.message); }
        }
        return { dir, groups, errors };
    }

    function runCommand(tool) {
        return new Promise((resolve) => {
            exec(tool.command, { cwd: tool.cwd || undefined, timeout: CMD_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true }, (err, stdout, stderr) => {
                const out = String(stdout || '') + String(stderr || '');
                if (err) resolve({ ok: false, output: (out || '') + (err.message ? (out ? '\n' : '') + err.message : '') });
                else resolve({ ok: true, output: out });
            });
        });
    }

    async function runPlugin(tool) {
        const t = sanitizeTool(tool);
        if (!t) return { ok: false, output: '插件定义无效' };
        try {
            if (t.type === 'command') {
                terminalWrite('[plugin] 执行: ' + t.command + '\n');
                return await runCommand(t);
            }
            if (t.type === 'url') { await shell.openExternal(t.url); return { ok: true, output: '已打开: ' + t.url }; }
            if (t.type === 'openPath') {
                const err = await shell.openPath(t.path);
                return err ? { ok: false, output: err } : { ok: true, output: '已打开: ' + t.path };
            }
            if (t.type === 'copy') { clipboard.writeText(t.text || ''); return { ok: true, output: '已复制到剪贴板' }; }
            return { ok: true, output: t.text || '' };
        } catch (e) { return { ok: false, output: e.message }; }
    }

    ipcMain.handle('tools:pluginsList', () => listPlugins());
    ipcMain.handle('tools:pluginRun', (_e, tool) => runPlugin(tool));
    ipcMain.handle('tools:pluginsOpenDir', async () => { ensureDir(); const err = await shell.openPath(dir); return err ? { error: err } : { ok: true }; });
    ipcMain.handle('tools:pluginsDir', () => dir);

    return { listPlugins, runPlugin, dir };
}

const README_TEXT = "# 套壳工具箱插件目录\n\n把 .json 文件放到本目录，重新打开工具箱即可在「🧩 插件工具」分组看到。\n\n路径以工具箱「打开插件目录」显示的为准（开发版 %APPDATA%\\sillytavern-electron\\shell-tools，安装版 %APPDATA%\\SillyTavern\\shell-tools）。\n\n格式与示例见套壳仓库 docs/toolbox-plugins.md。\n";
